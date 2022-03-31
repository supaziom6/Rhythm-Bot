import { IRhythmBotConfig, RhythmBot } from '../bot';
import { MediaItem } from '../media';
import { secondsToTimestamp, joinUserChannel } from '../helpers';
import { IBotPlugin, IBot, SuccessfulParsedMessage, Message, CommandMap, Client, IBotConfig } from 'discord-bot-quickstart';
import { Readable } from 'stream';
import * as ytdl from 'ytdl-core';
import * as ytpl from 'ytpl';

const commandName: string = 'play';

export default class YoutubePlugin extends IBotPlugin {
    bot: RhythmBot;

    preInitialize(bot: IBot<IRhythmBotConfig>): void {
        this.bot = bot as RhythmBot;
        this.bot.helptext += '\n`youtube [url/idfragment]` - Add youtube audio to the queue\n';
    }

    registerDiscordCommands(map: CommandMap<(cmd: SuccessfulParsedMessage<Message>, msg: Message) => void>) {
        map.on(commandName, (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
            return this.addSongAndPlayMusic(cmd);
        });
    }

    registerConsoleCommands() { }

    clientBound() { }

    postInitialize() { }
    
    onReady() { }

    async addSongAndPlayMusic(cmd: SuccessfulParsedMessage<Message>){
        if (cmd.body.length > 0) {
            await this.bot.player.addMedia(cmd.body);
            if (!this.bot.player.connection) {
                let conn = await joinUserChannel(cmd.message);
                this.bot.player.connection = conn;
                if (!this.bot.player.playing) {
                    this.bot.player.play();
                }
            }
        }
    }

}
