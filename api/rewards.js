const EXPLORER_API = 'https://explorer-mainnet.xo.market/api';
const RPC = 'https://rpc-mainnet-2.xo.market';
const USDC = '0x80c12230ce677e6f304027a14780edd2a829ab0c';
const DISTRIBUTOR = '0x1f6edbc28d1fd8156c4096b27cd296a0bd6e3e4f';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const DISTRIBUTOR_TOPIC = '0x' + DISTRIBUTOR.slice(2).padStart(64, '0');
const START_BLOCK = 10500000;
const CAMPAIGN_START_TS = Date.parse('2026-09-19T00:00:00Z') / 1000;
const BUDGET_MICRO = 1_000_000n * 1_000_000n;
const MAX_ROWS = 1000;

function hexToNumber(v) {
  if (typeof v !== 'string') return 0;
  return Number.parseInt(v, 16);
}

function topicToAddress(topic) {
  if (!topic || typeof topic !== 'string') return null;
  return '0x' + topic.slice(-40).toLowerCase();
}

function formatMicro(v) {
  const neg = v < 0n;
  const n = neg ? -v : v;
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole.toString()}${frac ? '.' + frac : ''}`;
}

async function getLatestBlock() {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
  });
  if (!r.ok) throw new Error(`RPC HTTP ${r.status}`);
  const j = await r.json();
  if (!j.result) throw new Error('RPC returned no block number');
  return Number.parseInt(j.result, 16);
}

async function getLogsRange(fromBlock, toBlock, depth = 0) {
  if (depth > 28) throw new Error('Explorer split depth exceeded');

  const u = new URL(EXPLORER_API);
  u.searchParams.set('module', 'logs');
  u.searchParams.set('action', 'getLogs');
  u.searchParams.set('fromBlock', String(fromBlock));
  u.searchParams.set('toBlock', String(toBlock));
  u.searchParams.set('address', USDC);
  u.searchParams.set('topic0', TRANSFER_TOPIC);
  u.searchParams.set('topic1', DISTRIBUTOR_TOPIC);
  u.searchParams.set('topic0_1_opr', 'and');

  const r = await fetch(u, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`Explorer HTTP ${r.status}`);
  const j = await r.json();
  const rows = Array.isArray(j.result) ? j.result : [];

  if (rows.length < MAX_ROWS) return rows;
  if (fromBlock >= toBlock) {
    throw new Error(`Single block ${fromBlock} hit explorer ${MAX_ROWS}-log cap`);
  }

  const mid = Math.floor((fromBlock + toBlock) / 2);
  const [left, right] = await Promise.all([
    getLogsRange(fromBlock, mid, depth + 1),
    getLogsRange(mid + 1, toBlock, depth + 1),
  ]);
  return left.concat(right);
}

module.exports = async function handler(req, res) {
  try {
    const latestBlock = await getLatestBlock();
    const rawLogs = await getLogsRange(START_BLOCK, latestBlock);

    const seen = new Set();
    const transfers = [];

    for (const log of rawLogs) {
      const topics = Array.isArray(log.topics) ? log.topics : [];
      if (topics.length < 3) continue;
      if (String(topics[0]).toLowerCase() !== TRANSFER_TOPIC) continue;
      if (String(topics[1]).toLowerCase() !== DISTRIBUTOR_TOPIC) continue;

      const ts = hexToNumber(log.timeStamp);
      if (!ts || ts < CAMPAIGN_START_TS) continue;

      const txHash = log.transactionHash || '';
      const logIndex = log.logIndex || '';
      const key = `${txHash}:${logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const micro = BigInt(log.data || '0x0');
      transfers.push({
        ts,
        micro,
        to: topicToAddress(topics[2]),
        txHash,
        blockNumber: hexToNumber(log.blockNumber),
      });
    }

    transfers.sort((a, b) => a.ts - b.ts || a.blockNumber - b.blockNumber);

    let totalMicro = 0n;
    const recipients = new Set();
    const dailyMap = new Map();

    for (const t of transfers) {
      totalMicro += t.micro;
      if (t.to) recipients.add(t.to);
      const day = new Date(t.ts * 1000).toISOString().slice(0, 10);
      const d = dailyMap.get(day) || { date: day, micro: 0n, transfers: 0, recipients: new Set() };
      d.micro += t.micro;
      d.transfers += 1;
      if (t.to) d.recipients.add(t.to);
      dailyMap.set(day, d);
    }

    const daily = [...dailyMap.values()].map((d) => ({
      date: d.date,
      amount: formatMicro(d.micro),
      transfers: d.transfers,
      recipients: d.recipients.size,
    }));

    const remainingMicro = BUDGET_MICRO > totalMicro ? BUDGET_MICRO - totalMicro : 0n;
    const pct = Number(totalMicro * 1_000_000n / BUDGET_MICRO) / 10_000;
    const last = transfers.length ? transfers[transfers.length - 1] : null;

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({
      ok: true,
      updatedAt: new Date().toISOString(),
      source: 'XO Market Blockscout, USDC.e Transfer logs',
      campaign: {
        announcedBudget: '1000000',
        trackingSince: '2026-09-19',
        distributor: DISTRIBUTOR,
        token: USDC,
      },
      totalDistributed: formatMicro(totalMicro),
      remaining: formatMicro(remainingMicro),
      percentDistributed: pct,
      transferCount: transfers.length,
      uniqueRecipients: recipients.size,
      latestBlock,
      lastPayout: last ? {
        timestamp: new Date(last.ts * 1000).toISOString(),
        amount: formatMicro(last.micro),
        recipient: last.to,
        txHash: last.txHash,
      } : null,
      daily,
    });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
