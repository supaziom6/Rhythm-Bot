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
            return new Promise<void>(done => {
                if(cmd.arguments.length > 0) {
                    cmd.arguments.forEach(arg => {
                        this.bot.player.addMedia(arg).then(() => {
                            done();
                        })
                    });
                }
            }).then(() => {
                if(!this.bot.player.connection) {
                    joinUserChannel(msg)
                        .then(conn => {
                            this.bot.player.connection = conn;
                            if(!this.bot.player.playing) {                        
                                this.bot.player.play();
                            }
                        })
                }
                
            });
        });
    }

    registerConsoleCommands() { }

    clientBound() { }

    postInitialize() { }
    
    onReady() { }

}
