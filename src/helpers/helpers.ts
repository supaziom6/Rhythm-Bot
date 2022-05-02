import { joinVoiceChannel, VoiceConnection } from '@discordjs/voice';
import { Message, MessageEmbed } from 'discord.js';

export function joinUserChannel(msg: Message): Promise<VoiceConnection> {
    return new Promise((done, error) => {
        let channel = msg.member.voice.channel;
        if(channel && channel.type === 'GUILD_VOICE') {
            done(joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false
            }));
        } else
            error(`User isn't on a voice channel!`);
    });
}

export function createEmbedObj (msg: MessageEmbed)
{
    return { embeds: [msg] };
}

export function createEmbed() {
    return new MessageEmbed()
        .setColor('#a600ff');
}

export function createErrorEmbed(message: string) {
    return new MessageEmbed()
        .setColor('#ff3300')
        .setTitle('Error')
        .setDescription(message);
}

export function createInfoEmbed(title: string, message: string = '') {
    return new MessageEmbed()
        .setColor('#0099ff')
        .setTitle(title)
        .setDescription(message);
}
