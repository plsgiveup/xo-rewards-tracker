# XO Liquidity Rewards Tracker

A tiny Vercel app that tracks XO Market's confirmed liquidity-reward distributor on XO Mainnet.

## What it tracks

- Distributor: `0x1f6edbc28d1fd8156c4096b27cd296a0bd6e3e4f`
- Token: Bridged USDC (XO) / USDC.e `0x80c12230ce677e6f304027a14780edd2a829ab0c`
- Program budget: $1,000,000
- Campaign tracking start: Sep 21, 2026 (UTC day boundary)
- Data source: XO Market Blockscout event logs

The API filters ERC-20 `Transfer` events where the distributor is the indexed `from` address. It recursively splits block ranges if Blockscout's 1,000-log cap is reached.

## Deploy to Vercel

1. Put these files in a GitHub repository.
2. Import the repository in Vercel.
3. Deploy with the default settings. There are no environment variables or secrets.

The `/api/rewards` response is cached at the edge for 5 minutes.
