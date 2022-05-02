import { IRhythmBotConfig, RhythmBot } from '../bot';
import { joinUserChannel } from '../helpers';
import { IBotPlugin, IBot, SuccessfulParsedMessage, Message, CommandMap } from 'discord-bot-quickstart';

export default class YoutubePlugin extends IBotPlugin {
    bot: RhythmBot;

    preInitialize(bot: IBot<IRhythmBotConfig>): void {
        this.bot = bot as RhythmBot;
        this.bot.helptext += '\n`add [url/idfragment]` - Add youtube audio to the queue\n';
    }

    registerDiscordCommands(map: CommandMap<(cmd: SuccessfulParsedMessage<Message>, msg: Message) => void>) {
        map.on('play', (cmd: SuccessfulParsedMessage<Message>, msg: Message) => {
            this.addAndPlayMusicAsync(cmd);
        });
    }

    registerConsoleCommands() { }

    clientBound() { }

    postInitialize() { }
    
    onReady() { }

    async addAndPlayMusicAsync(cmd: SuccessfulParsedMessage<Message>): Promise<void> {
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
