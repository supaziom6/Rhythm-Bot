import { MediaPlayer } from '../media';
import { BotStatus } from './bot-status';
import { IRhythmBotConfig } from './bot-config';
import { createInfoEmbed, secondsToTimestamp } from '../helpers';
import { IBot, CommandMap, Client, ParsedArgs, Interface, SuccessfulParsedMessage, Message, readFile, MessageReaction, User } from 'discord-bot-quickstart';

const helptext = readFile('../helptext.txt');
const random = (array) => {
    return array[Math.floor(Math.random() * array.length)];
};
const pingPhrases = [ 
    `Can't stop won't stop!`, 
    `:ping_pong: Pong Bitch!` 
];

export class RhythmBot extends IBot<IRhythmBotConfig> {
    helptext: string;
    player: MediaPlayer;
    status: BotStatus;

    constructor(config: IRhythmBotConfig) {
        super(config, <IRhythmBotConfig>{
            auto: {
                deafen: false,
                pause: false,
                play: false,
                reconnect: true
            },
            discord: {
                log: true
            },
            command: {
                symbol: '!'
            },
            directory: {
                plugins: './plugins',
                logs: '../bot.log'
            },
            queue: {
                announce: true,
                repeat: false
            },
            stream: {
                seek: 0,
                volume: 1,
                bitrate: 'auto',
                forwardErrorCorrection: false
            },
            emojis: {
                addSong: '👍',
                stopSong: '⏹️',
                playSong: '▶️',
                pauseSong: '⏸️',
                skipSong: '⏭️'
            }
        });
        this.helptext = helptext;
    }

    onRegisterDiscordCommands(map: CommandMap<(cmd: SuccessfulParsedMessage<Message>, msg: Message) => void>): void {
        map.on('ping', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
                let phrases = pingPhrases.slice();
                if(msg.guild)
                    phrases = phrases.concat(msg.guild.emojis.cache.array().map(x => x.name));
                msg.channel.send(random(phrases));
            })
            .on('help', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
                msg.channel.send(this.helptext);
            })
            .on('leave', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
                this.player.stop();
                this.player.connection = null;
                this.client.voice.connections.forEach(conn => {
                    conn.disconnect();
                    msg.channel.send(createInfoEmbed(`Disconnecting from channel: ${conn.channel.name}`));
                });
            })
            .on('pause', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
                this.player.pause();
            })
            .on('np', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
                let media = this.player.queue.first;
                if(this.player.playing && this.player.dispatcher) {
                    let elapsed = secondsToTimestamp(this.player.dispatcher.totalStreamTime / 1000);
                    msg.channel.send(createInfoEmbed('Time Elapsed', `${elapsed} / ${media.duration}`));
                } else if(this.player.queue.first) {
                    msg.channel.send(createInfoEmbed('Time Elapsed', `00:00:00 / ${media.duration}`));
                }
            })
            .on('remove', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
                if(cmd.arguments.length > 0) {
                    let idx = parseInt(cmd.arguments[0]);
                    let item = this.player.at(idx - 1);
                    if(item) {
                        this.player.remove(item);
                    }
                }
            })
            .on('skip', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
                this.player.skip();
            })
            .on('stop', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
                this.player.stop();
            })
            .on('list', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
                let items = this.player.queue
                    .map((item, idx) => `${idx + 1}. Title: "${item.name}"`);
                if(items.length > 0)
                    msg.channel.send(createInfoEmbed('Current Playing Queue', items.join('\n\n')));
                else
                    msg.channel.send(createInfoEmbed(`There are no songs in the queue.`));
            })
            .on('clear', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
                this.player.clear();
            })
            .on('move', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
                if(cmd.arguments.length > 1) {
                    let current = Math.min(Math.max(parseInt(cmd.arguments[0]), 0), this.player.queue.length - 1),
                        targetDesc = cmd.arguments[0],
                        target = 0;
                    if(targetDesc == 'up')
                        target = Math.min(current - 1, 0);
                    else if(targetDesc == 'down')
                        target = Math.max(current + 1, this.player.queue.length - 1);
                    else
                        target = parseInt(targetDesc);

                    this.player.move(current, target);
                }
            })
            .on('shuffle', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
                this.player.shuffle();
            })
            .on('volume', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
                if(cmd.arguments.length > 0) {
                    let temp = cmd.arguments[0];
                    if(temp) {
                        let volume = Math.min(Math.max(parseInt(temp), 0), 100);
                        this.player.setVolume(volume);
                    }
                }
                msg.channel.send(createInfoEmbed(`Volume is at ${this.player.getVolume()}`));
            })
            .on('repeat', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
                this.config.queue.repeat = !this.config.queue.repeat;
                msg.channel.send(createInfoEmbed(`Repeat mode is ${this.config.queue.repeat ? 'on':'off'}`));
            });
    }

    parsedMessage(msg: SuccessfulParsedMessage<Message>) {
        const handlers = this.commands.get(msg.command);
        if (handlers) {
            this.player.channel = msg.message.channel;
        }
    }

    onClientCreated(client: Client): void {
        this.status = new BotStatus(client);
        this.player = new MediaPlayer(this.config, this.status, this.logger);

        client.on('messageReactionAdd', async (reaction: MessageReaction, user: User) => {
            if (reaction.partial) {
                try {
                    await reaction.fetch();
                } catch (error) {
                    this.logger.debug(error);
                    return;
                }
            }
            if (reaction.message.author.id === this.client.user.id && user.id !== this.client.user.id) {
                if (reaction.message.embeds.length > 0) {
                    const embed = reaction.message.embeds[0];
                    if (embed) {
                        if (reaction.emoji.name === this.config.emojis.addSong && embed.url) {
                            this.logger.debug(`Emoji Click: Adding Media: ${embed.url}`);
                            this.player.addMedia(embed.url);
                        }
                        if (reaction.emoji.name === this.config.emojis.stopSong) {
                            this.logger.debug('Emoji Click: Stopping Song');
                            this.player.stop();
                        }
                        if (reaction.emoji.name === this.config.emojis.playSong) {
                            this.logger.debug('Emoji Click: Playing/Resuming Song');
                            this.player.play();
                        }
                        if (reaction.emoji.name === this.config.emojis.pauseSong) {
                            this.logger.debug('Emoji Click: Pausing Song');
                            this.player.pause();
                        }
                        if (reaction.emoji.name === this.config.emojis.skipSong) {
                            this.logger.debug('Emoji Click: Skipping Song');
                            this.player.skip();
                        }
                    }
                    reaction.users.remove(user.id);
                }
            }
        })
    }

    onReady(client: Client): void {
        this.player.determineStatus();
        console.log(`Guilds: ${this.client.guilds.cache.keyArray().length}`);
        this.client.guilds.cache.forEach(guild => {
            console.log(`Guild Name: ${guild.name}`);
            const manageMessagesRole = guild.roles.cache.has('MANAGE_MESSAGES');
            console.log(`- Can Manage Messages: ${manageMessagesRole}`);
        });
    }

    onRegisterConsoleCommands(map: CommandMap<(args: ParsedArgs, rl: Interface) => void>): void { }
    
}
