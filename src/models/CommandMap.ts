export class CommandMap<T> extends Map<string, Array<T>> {
    constructor(...args: any) {
        super(...args);
    }
    on(cmd: string, handler: T) {
        if (!this.has(cmd))
            this.set(cmd, [handler]);
        else
            this.get(cmd).push(handler);
        return this;
    }
}
