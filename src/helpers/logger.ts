import readline from "readline";
import winston from "winston";
import path from 'path';

const logPath = "../bot.log"
const lineFormat = winston.format.printf(({ level, message, timestamp }) => {
    return `[${timestamp}] (${level}): ${message}`;
});


export function createLogger():winston.Logger {
    return winston.createLogger({
        level: 'silly',
        format: winston.format.combine(winston.format.timestamp(), lineFormat),
        transports: [
            new winston.transports.Console(),
            new winston.transports.File({ filename: path.basename(logPath), dirname: path.dirname(logPath), maxsize: 1e+7 })
        ]
    });
}