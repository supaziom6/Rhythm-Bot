import { MediaPlayer } from '../media';
import { BotStatus } from './bot-status';
import { IRhythmBotConfig } from './bot-config';
import { createLogger, joinUserChannel } from '../helpers';
import { Client, ClientOptions, Intents, Message, MessageReaction, User } from 'discord.js';
import winston from 'winston';
import { CommandMap } from '../models/CommandMap';
import { parse, SuccessfulParsedMessage } from "discord-command-parser";
import { getVoiceConnection } from "@discordjs/voice"
import fs from "fs";

const helptext = fs.readFileSync(__dirname + '/../../../helptext.txt', { encoding: 'utf8' });
const random = (array) => {
    return array[Math.floor(Math.random() * array.length)];
};
const pingPhrases = [ 
    `Can't stop won't stop!`, 
    `:ping_pong: Pong Bitch!` 
];

export class RhythmBot {
    readonly commands: CommandMap<(cmd: SuccessfulParsedMessage<Message<boolean>>, msg: Message) => void>;
    helptext: string;
    player: MediaPlayer;
    status: BotStatus;
    logger: winston.Logger;
    config: IRhythmBotConfig;
    client: Client;

    constructor(config: IRhythmBotConfig) {
        config.auto = {
                deafen: false,
                pause: false,
                play: false,
                reconnect: true
            };
        config.queue = {
                announce: true,
                repeat: false
            };
        config.stream = {
                seek: 0,
                volume: 1,
                bitrate: 'auto',
                forwardErrorCorrection: false
            };
        config.emojis = {
                addSong: '👍',
                stopSong: '⏹️',
                playSong: '▶️',
                pauseSong: '⏸️',
                skipSong: '⏭️'
            };
        this.config = config;

        this.helptext = helptext;
        this.logger = createLogger();
        this.commands = new CommandMap();

        const myIntents = new Intents();
        myIntents.add(Intents.FLAGS.GUILD_VOICE_STATES);
        myIntents.add(Intents.FLAGS.GUILDS);
        myIntents.add(Intents.FLAGS.GUILD_MESSAGES);
        myIntents.add(Intents.FLAGS.GUILD_MESSAGE_REACTIONS);

        let options: ClientOptions = {
            shards: "auto",
            intents: myIntents,
            partials: ['MESSAGE', 'CHANNEL', 'REACTION'],
        };


        this.client = new Client(options);
        this.client.login(config.token);

        // Notify when they client is online
        this.client.on('ready', () => {
            console.log('Bot Online');
            this.onReady(this.client);
        });

        // Process Messages and turn them into commands
        this.client.on("messageCreate", async (message) => {
            let parsed = parse(message, this.config.prefix);
            if (!parsed.success)
                return;
            this.parsedMessage(parsed);
            let handlers = this.commands.get(parsed.command);
            if (handlers) {
                console.log(`Bot Command: ${message.content}`);
                handlers.forEach(handle => {
                    handle(parsed as SuccessfulParsedMessage<Message<boolean>>, message);
                });
            }
        });

        // Handel any client errors.
        this.client.on('error', (error) => {
            console.log(error);
        });
        
        this.onClientCreated(this.client);
        this.onRegisterDiscordCommands(this.commands);

    }

    onRegisterDiscordCommands(map: CommandMap<(cmd: SuccessfulParsedMessage<Message>, msg: Message) => void>): void {
        map.on('ping', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
                let phrases = pingPhrases.slice();
                if(msg.guild)
                    phrases = phrases.concat(msg.guild.emojis.cache.map(x => x.name));
                msg.channel.send(random(phrases));
            })
            .on('help', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
                msg.channel.send(this.helptext);
            })
            .on('leave', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
                this.player.stop();
                this.player.connection = null;
                const connection = getVoiceConnection(msg.guild.id);
                connection.destroy();
            })
            .on('pause', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
                this.player.pause();
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
            // .on('list', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
            //     let items = this.player.queue
            //         .map((item, idx) => `${idx + 1}. Title: "${item.name}"`);
            //     if(items.length > 0)
            //         msg.channel.send(createInfoEmbed('Current Playing Queue', items.join('\n\n')));
            //     else
            //         msg.channel.send(createInfoEmbed(`There are no songs in the queue.`));
            // })
            .on('clear', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
                this.player.clear();
            })
            .on('play', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
                this.addAndPlayMusicAsync(cmd);
            });
    }

    async addAndPlayMusicAsync(cmd: SuccessfulParsedMessage<Message>) {
        if (cmd.body.length > 0) {
            await this.player.addMedia(cmd.body);
            if (!this.player.connection) {
                let conn = await joinUserChannel(cmd.message);
                this.player.connection = conn;
                this.player.connect();
            }
            if (!this.player.playing) {
                this.player.play();
            }
        }
    }

    parsedMessage(msg: SuccessfulParsedMessage<Message<boolean>>) {
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
                    console.log(error);
                    return;
                }
            }
            if (reaction.message.author.id === this.client.user.id && user.id !== this.client.user.id) {
                if (reaction.message.embeds.length > 0) {
                    const embed = reaction.message.embeds[0];
                    if (embed) {
                        if (reaction.emoji.name === this.config.emojis.addSong && embed.url) {
                            console.log(`Emoji Click: Adding Media: ${embed.url}`);
                            this.player.addMedia(embed.url);
                        }
                        if (reaction.emoji.name === this.config.emojis.stopSong) {
                            console.log('Emoji Click: Stopping Song');
                            this.player.stop();
                        }
                        if (reaction.emoji.name === this.config.emojis.playSong) {
                            console.log('Emoji Click: Playing/Resuming Song');
                            this.player.play();
                        }
                        if (reaction.emoji.name === this.config.emojis.pauseSong) {
                            console.log('Emoji Click: Pausing Song');
                            this.player.pause();
                        }
                        if (reaction.emoji.name === this.config.emojis.skipSong) {
                            console.log('Emoji Click: Skipping Song');
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
        console.log(`Guilds: ${this.client.guilds.cache.keys.length}`);
        this.client.guilds.cache.forEach(guild => {
            console.log(`Guild Name: ${guild.name}`);
            const manageMessagesRole = guild.roles.cache.has('MANAGE_MESSAGES');
            console.log(`- Can Manage Messages: ${manageMessagesRole}`);
        });
    }
    
}
