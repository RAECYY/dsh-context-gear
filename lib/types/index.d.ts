export declare const name = "context-gear";
export declare const inject: string[];
export declare function apply(ctx: any): void;
export declare const TIER_POLICY: Record<string, { maxTokens: number; retainTokens: number; thresholdRatio: number }>;
export declare const TIER_PROMPTS: Record<string, string>;
