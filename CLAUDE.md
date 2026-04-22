# Project Rules

## Testing
- All written code must be covered with tests where it makes sense.
- Tests must be strict: include boundary cases, unusual examples, and rare edge cases.
- After any code change run `npx tsc --noEmit` and `npx vitest run`.

## Trading Logic
- Trading logic must exist in a single instance (`TradingCore`).
- Both live trading (`PairRunner`) and strategy backtesting (`BacktestEngine`) must use the same `TradingCore` methods.
- If backtesting logic differs from live trading logic even slightly — it must be fixed immediately.
- Backtesting must work as if live trading was launched, only with candles substituted from history.
