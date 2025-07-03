import { Context, Schema } from 'koishi';
import 'koishi-plugin-chatluna';
export declare const name = "autochat";
export declare const reusable = true;
export declare const inject: string[];
export interface Config {
    interval: number;
    prompt: string;
    channelId: string;
    channelType?: 'group' | 'private';
    botSelfId?: string;
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, config: Config): void;
