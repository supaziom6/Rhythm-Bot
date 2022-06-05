import { IRhythmBotConfig } from '../bot/bot-config';
import { BotStatus } from '../bot/bot-status';
import { MediaQueue } from './media-queue';
import { MediaItem } from './media-item.model';
import { IMediaType } from './media-type.model';
import { createEmbed, createEmbedObj, createErrorEmbed, createInfoEmbed } from '../helpers';
import { Readable } from 'stream';
import ytdl from 'ytdl-core';
import ytpl from 'ytpl';
import yts from 'yt-search';
import { Logger } from 'winston';
import { DiscordAPIError, DMChannel, NewsChannel, PartialDMChannel, TextChannel, ThreadChannel } from 'discord.js';
import { AudioPlayer, AudioPlayerStatus, createAudioPlayer, AudioResource, createAudioResource, NoSubscriberBehavior, VoiceConnection, demuxProbe } from '@discordjs/voice';
import { createReadStream, ReadStream } from 'fs';
import { PassThrough } from 'stream';

export class MediaPlayer {
    typeRegistry: Map<string, IMediaType> = new Map<string, IMediaType>();
    queue: MediaQueue = new MediaQueue();
    playing: boolean = false;
    paused: boolean = false;
    stopping: boolean = false;
    config: IRhythmBotConfig;
    status: BotStatus;
    logger: Logger;
    channel: TextChannel | DMChannel | NewsChannel | PartialDMChannel | ThreadChannel;
    connection?: VoiceConnection;
    dispatcher?: AudioPlayer;

    constructor(config: IRhythmBotConfig, status: BotStatus, logger: Logger) {
        this.config = config;
        this.status = status;
        this.logger = logger;
        this.dispatcher = createAudioPlayer({
            debug: true,
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Play
            }
        });
        
        this.dispatcher.on('debug', (info: string) => {
            console.log(info);
        });
        this.dispatcher.on('error', err => {
            console.log(err);
            if(this.channel){
                this.channel.send(createEmbedObj(createErrorEmbed(`Error Playing Song: ${err}`)));
            }
            this.skip();
        });
        this.dispatcher.on(AudioPlayerStatus.Idle, idle_AudioPlayerEvents => {
            this.skip(true);
            console.log(idle_AudioPlayerEvents);
        });
    }

    connect()
    {
        this.connection.subscribe(this.dispatcher);
    }


    async getStream(item: MediaItem): Promise<AudioResource<MediaItem>> 
    {
        var vidInfo = await ytdl.getInfo(item.url);
        var stream = ytdl.downloadFromInfo(vidInfo)
        return createAudioResource(stream, { metadata: item });
    }

    async addMedia(url: string): Promise<void> {
        try {
            if (!url.includes('https://')) {
                yts({
                    query: url,
                    pages: 1
                }, async (err, result) => {
                    await this.QueuYoutubeSong(result.videos[0].url);
                });
            }
            else if (url.includes('/playlist')) {
                let playlist = await ytpl(url)
                const items = playlist.items.map(item => (<MediaItem>{ url: item.url, name: item.title }));
                items.forEach(element => {
                    this.determineStatus();
                    this.queue.enqueue(element);
                });

                if (this.channel) {
                    let itemsS = items.map((item_2, idx) => `${idx + 1}. Title: "${item_2.name}"`);
                    this.channel.send( 
                        createEmbedObj(createInfoEmbed('Tracks Added', itemsS.join('\n\n')))
                    ).catch(err => console.log(err));
                }
            }
            else {
                await this.QueuYoutubeSong(url);
            }
        } catch (err) {
            if (this.channel)
                this.channel.send(
                    createEmbedObj(createErrorEmbed(`Error adding track: ${err}`)));
        }
    }

    async QueuYoutubeSong(url: string) {
        let info = await ytdl.getInfo(url);
        let temp:any;
        temp = info;
        let item:MediaItem = {
            url: url,
            name: info.videoDetails.title ? info.videoDetails.title : 'Unknown',
        };
            
        this.queue.enqueue(item);
        
        let playlist = temp.response.contents.twoColumnWatchNextResults.playlist;
        if(playlist){
            playlist.contents.forEach(element => {
                if(element.playlistPanelVideoRenderer)
                {
                    let item2:MediaItem ={
                        url: `https://www.youtube.com/watch?v=${element.playlistPanelVideoRenderer.videoId}`,
                        name: element.playlistPanelVideoRenderer.title.simpleText,
                        duration: element.playlistPanelVideoRenderer.lengthText.simpleText
                    }
                    this.determineStatus();
                    this.queue.enqueue(item2);
                }
            });
        }
        
        if(this.channel && item)
            this.channel.send(
                
                createEmbedObj(
                    createEmbed()
                    .setTitle('Track Added')
                    .addFields(
                        { name: 'Title:', value: item.name },
                        { name: 'Position:', value: `${this.queue.indexOf(item) + 1}`, inline: true },
                        )
                ));
    }


    at(idx: number) {
        return this.queue[idx];
    }

    remove(item: MediaItem) {
        if(item == this.queue.first && (this.playing || this.paused))
            this.stop();
        this.queue.dequeue(item);
        this.determineStatus();
        if(this.channel)
            this.channel.send(
                createEmbedObj(createInfoEmbed(`Track Removed`, `${item.name}`)));
    }

    clear() {
        if(this.playing || this.paused)
            this.stop();
        this.queue.clear();
        this.determineStatus();
        if(this.channel)
            this.channel.send(
                createEmbedObj(createInfoEmbed(`Playlist Cleared`)));
    }

    async dispatchStream(stream: AudioResource<MediaItem>) {

        this.dispatcher.play(stream);
        this.playing = true;
        this.determineStatus();
        if(this.channel) {
            const msg = await this.channel.send(
                createEmbedObj(
                    createEmbed()
                    .setTitle('▶️ Now playing')
                    .setDescription(`${stream.metadata.name}`)));
            msg.react(this.config.emojis.stopSong);
            msg.react(this.config.emojis.playSong);
            msg.react(this.config.emojis.pauseSong);
            msg.react(this.config.emojis.skipSong);
        }
    }

    play() {
        if(this.queue.length == 0 && this.channel)
            this.channel.send(
                createEmbedObj(createInfoEmbed(`Queue is empty! Add some songs!`)));
        let item = this.queue.first;
        if(item && this.connection) {
            if(!this.playing) {
                this.getStream(item)
                    .then(stream => {
                        this.dispatchStream(stream);
                    });
            } else if(this.paused && this.dispatcher) {
                this.dispatcher.unpause();
                this.paused = false;
                this.determineStatus();
                if(this.channel)
                    this.channel.send(
                        createEmbedObj(createInfoEmbed(`⏯️ "${this.queue.first.name}" resumed`)));
            }
        }
    }

    stop() {
        if(this.playing && this.dispatcher) {
            let item = this.queue.first;
            this.stopping = true;
            this.paused = false;
            this.playing = false;
            this.dispatcher.pause();
            this.dispatcher = null;
            this.determineStatus();
            if(this.channel)
                this.channel.send(
                    createEmbedObj(createInfoEmbed(`⏹️ "${item.name}" stopped`)));
        }
    }

    async skip(noMessage: boolean = false) {
        let item = this.queue.first;
        this.queue.dequeue();
        let itemNew = this.queue.first;
        
        if(itemNew != null){
            this.paused = false;
            let stream = await this.getStream(itemNew);
            await this.dispatchStream(stream);
        }
        else{
            this.dispatcher.stop();
        }


        if(!noMessage && this.channel && item != null){
            await this.channel.send(createEmbedObj(createInfoEmbed(`⏭️ "${item.name}" skipped`)));
        }
        this.determineStatus();
    }

    pause() {
        if(this.playing && !this.paused && this.dispatcher) {
            this.dispatcher.pause();
            this.paused = true;
            this.determineStatus();
            if(this.channel)
                this.channel.send(
                    createEmbedObj(createInfoEmbed(`⏸️ "${this.queue.first.name}" paused`)));
        }
    }

    shuffle() {
        if(this.playing || this.paused)
            this.stop();
        this.queue.shuffle();
        this.determineStatus();
        if(this.channel)
            this.channel.send(
                createEmbedObj(createInfoEmbed(`🔀 Queue Shuffled`)));
    }

    move(currentIdx: number, targetIdx: number) {
        let max = this.queue.length - 1;
        let min = 0;
        currentIdx = Math.min(Math.max(currentIdx, min), max);
        targetIdx = Math.min(Math.max(targetIdx, min), max);

        if(currentIdx != targetIdx) {
            this.queue.move(currentIdx, targetIdx);
            this.determineStatus();
        }
    }

    determineStatus() {
        let item = this.queue.first;
        if(item) {
            if(this.playing) {
                if(this.paused) {
                    this.status.setBanner(`Paused: "${item.name}"`);
                } else {
                    this.status.setBanner(`Now Playing: "${item.name}"${this.queue.length > 1 ? `, Up Next "${this.queue[1].name}"`:''}`);
                }
            } else
                this.status.setBanner(`Up Next: "${item.name}"`);
        } else
            this.status.setBanner(`No Songs In Queue`);
    }

}
