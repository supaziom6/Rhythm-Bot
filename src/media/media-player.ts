import { IRhythmBotConfig } from '../bot/bot-config';
import { BotStatus } from '../bot/bot-status';
import { MediaQueue } from './media-queue';
import { MediaItem } from './media-item.model';
import { IMediaType } from './media-type.model';
import { secondsToTimestamp } from '../helpers';
import { createEmbed, createErrorEmbed, createInfoEmbed } from '../helpers';
import { Logger, TextChannel, DMChannel, NewsChannel, VoiceConnection, StreamDispatcher } from 'discord-bot-quickstart';
import { Readable } from 'stream';
import * as ytdl from 'ytdl-core';
import * as ytpl from 'ytpl';
import * as yts from 'yt-search';

export class MediaPlayer {
    typeRegistry: Map<string, IMediaType> = new Map<string, IMediaType>();
    queue: MediaQueue = new MediaQueue();
    playing: boolean = false;
    paused: boolean = false;
    stopping: boolean = false;
    config: IRhythmBotConfig;
    status: BotStatus;
    logger: Logger;
    channel: TextChannel | DMChannel | NewsChannel;
    connection?: VoiceConnection;
    dispatcher?: StreamDispatcher;

    constructor(config: IRhythmBotConfig, status: BotStatus, logger: Logger) {
        this.config = config;
        this.status = status;
        this.logger = logger;
    }

    getStream(item: MediaItem): Promise<Readable> 
    {
        return new Promise<Readable>((done, error) => 
        {
            let stream = ytdl(item.url, { filter: 'audioonly', quality: 'highestaudio' });
            if(stream)
                done(stream);
            else
                error('Unable to get media stream');
        });
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
                        createInfoEmbed('Tracks Added', itemsS.join('\n\n'))
                    );
                }
            }
            else {
                await this.QueuYoutubeSong(url);
            }
        } catch (err) {
            if (this.channel)
                this.channel.send(createErrorEmbed(`Error adding track: ${err}`));
        }
    }

    async QueuYoutubeSong(url: string) {
        let info = await ytdl.getInfo(url);
        let temp:any;
        temp = info;
        let item:MediaItem = {
            url: url,
            name: info.videoDetails.title ? info.videoDetails.title : 'Unknown',
            duration: secondsToTimestamp(parseInt(info.videoDetails.lengthSeconds) || 0)
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
                createEmbed()
                    .setTitle('Track Added')
                    .addFields(
                        { name: 'Title:', value: item.name },
                        { name: 'Position:', value: `${this.queue.indexOf(item) + 1}`, inline: true },
                        )
                );
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
            this.channel.send(createInfoEmbed(`Track Removed`, `${item.name}`));
    }

    clear() {
        if(this.playing || this.paused)
            this.stop();
        this.queue.clear();
        this.determineStatus();
        if(this.channel)
            this.channel.send(createInfoEmbed(`Playlist Cleared`));
    }

    dispatchStream(stream: Readable, item: MediaItem) {
        if(this.dispatcher) {
            this.dispatcher.end();
            this.dispatcher = null;
        }
        this.dispatcher = this.connection.play(stream, {
            seek: this.config.stream.seek,
            volume: this.config.stream.volume,
            bitrate: this.config.stream.bitrate,
            fec: this.config.stream.forwardErrorCorrection,
            plp: this.config.stream.packetLossPercentage,
            highWaterMark: 1<<25
        });
        this.dispatcher.on('start', async () => {
            this.playing = true;
            this.determineStatus();
            if(this.channel) {
                const msg = await this.channel.send(
                    createEmbed()
                        .setTitle('▶️ Now playing')
                        .setDescription(`${item.name}`)
                );
                msg.react(this.config.emojis.stopSong);
                msg.react(this.config.emojis.playSong);
                msg.react(this.config.emojis.pauseSong);
                msg.react(this.config.emojis.skipSong);
            }
        });
        this.dispatcher.on('debug', (info: string) => {
            this.logger.debug(info);
        });
        this.dispatcher.on('error', err => {
            this.skip();
            this.logger.error(err);
            if(this.channel)
                this.channel.send(createErrorEmbed(`Error Playing Song: ${err}`));
        });
        this.dispatcher.on('close', () => {
            this.logger.debug(`Stream Closed`);
            if (this.dispatcher) {
                this.playing = false;
                this.dispatcher = null;
                this.determineStatus();
                if(!this.stopping) {
                    let track = this.queue.dequeue();
                    if(this.config.queue.repeat)
                        this.queue.enqueue(track);
                        setTimeout(() => {
                            this.play();
                        }, 1000);
                }
                this.stopping = false;
            }
        });
        this.dispatcher.on('finish', () => {
            this.logger.debug('Stream Finished');
            if (this.dispatcher) {
                this.playing = false;
                this.dispatcher = null;
                this.determineStatus();
                if(!this.stopping) {
                    let track = this.queue.dequeue();
                    if(this.config.queue.repeat)
                        this.queue.enqueue(track);
                        setTimeout(() => {
                            this.play();
                        }, 1000);
                }
                this.stopping = false;
            }
        });
        this.dispatcher.on('end', (reason: string) => {
            this.logger.debug(`Stream Ended: ${reason}`);
        });
    }

    play() {
        if(this.queue.length == 0 && this.channel)
            this.channel.send(createInfoEmbed(`Queue is empty! Add some songs!`));
        let item = this.queue.first;
        if(item && this.connection) {
            if(!this.playing) {
                this.getStream(item)
                    .then(stream => {
                        this.dispatchStream(stream, item);
                    });
            } else if(this.paused && this.dispatcher) {
                this.dispatcher.resume();
                this.paused = false;
                this.determineStatus();
                if(this.channel)
                    this.channel.send(createInfoEmbed(`⏯️ "${this.queue.first.name}" resumed`));
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
            this.dispatcher.destroy();
            this.determineStatus();
            if(this.channel)
                this.channel.send(createInfoEmbed(`⏹️ "${item.name}" stopped`));
        }
    }

    skip() {
        if(this.playing && this.dispatcher) {
            let item = this.queue.first;
            this.paused = false;
            this.dispatcher.pause();
            this.dispatcher.destroy();
            if(this.channel)
                this.channel.send(createInfoEmbed(`⏭️ "${item.name}" skipped`));
        } else if(this.queue.length > 0) {
            let item = this.queue.first;
            this.queue.dequeue();
            if(this.channel)
                this.channel.send(createInfoEmbed(`⏭️ "${item.name}" skipped`));
        }
        this.determineStatus();
    }

    pause() {
        if(this.playing && !this.paused && this.dispatcher) {
            this.dispatcher.pause();
            this.paused = true;
            this.determineStatus();
            if(this.channel)
                this.channel.send(createInfoEmbed(`⏸️ "${this.queue.first.name}" paused`));
        }
    }

    shuffle() {
        if(this.playing || this.paused)
            this.stop();
        this.queue.shuffle();
        this.determineStatus();
        if(this.channel)
            this.channel.send(createInfoEmbed(`🔀 Queue Shuffled`));
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

    setVolume(volume: number) {
        volume = Math.min(Math.max((volume / 100) + 0.5, 0.5), 2);
        this.config.stream.volume = volume;
        if(this.dispatcher) {
            this.dispatcher.setVolume(volume);
        }
    }

    getVolume() {
        return ((this.config.stream.volume - 0.5) * 100) + '%';
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
