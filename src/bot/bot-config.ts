export interface IRhythmBotConfig {
    prefix: string,
    token: string,
    auto?: {
        deafen?: boolean,
        pause?: boolean,
        play?: boolean,
        reconnect?: boolean
    },
    queue?: {
        announce?: boolean;
        repeat?: boolean;
    },
    stream?: {
        seek?: number;
        packetLossPercentage?: number;
        forwardErrorCorrection?: boolean;
        volume?: number;
        bitrate?: number | 'auto';
    },
    emojis?: {
        addSong?: string;
        stopSong?: string;
        playSong?: string;
        pauseSong?: string;
        skipSong?: string;
    }
}
