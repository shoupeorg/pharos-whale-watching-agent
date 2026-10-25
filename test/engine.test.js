import test from "node:test";
import assert from "node:assert/strict";
import { buildReport, evaluateTransfers, formatAmount, nextScanRange, normalizeTransfer, parseAmount, reportCsv, validateConfig, ZERO, TRANSFER_TOPIC } from "../src/engine.js";
import { exampleConfig } from "../src/example.js";

const token = exampleConfig.tokens[0];
const topic = (address) => `0x${"0".repeat(24)}${address.slice(2)}`;
const log = ({ from=exampleConfig.addresses[0].address, to=exampleConfig.addresses[1].address, amount=1_000_000n, hash="1".repeat(64), index=0, block=10 }={}) => ({ address:token.address,blockNumber:`0x${block.toString(16)}`,blockTimestamp:"0x6553f100",data:`0x${amount.toString(16).padStart(64,"0")}`,logIndex:`0x${index.toString(16)}`,removed:false,topics:[TRANSFER_TOPIC,topic(from),topic(to)],transactionHash:`0x${hash}` });

test("requires five valid unique addresses and rejects case-insensitive duplicates",()=>{
  assert.equal(validateConfig(exampleConfig).addresses.length,5);
  assert.throws(()=>validateConfig({...exampleConfig,addresses:exampleConfig.addresses.slice(0,4)}),/between 5 and 20/);
  assert.throws(()=>validateConfig({...exampleConfig,addresses:[...exampleConfig.addresses.slice(0,4),{address:exampleConfig.addresses[0].address.toUpperCase().replace("0X","0x"),label:"duplicate"}]}),/Duplicate/);
});

test("exact decimal arithmetic honors equality boundary and rejects precision",()=>{
  assert.equal(parseAmount("1.000001",6),1000001n);
  assert.equal(formatAmount(1000001n,6),"1.000001");
  assert.throws(()=>parseAmount("0.0000001",6),/precision/);
  assert.throws(()=>parseAmount("-1",6),/non-negative/);
});

test("missing decimals block significance rather than assuming 18",()=>{
  const cfg={...exampleConfig,tokens:[{...token,decimals:null}]};
  const event=normalizeTransfer(log(),token);
  assert.equal(evaluateTransfers([event],cfg)[0].evaluation,"UNKNOWN");
});

test("deduplicates overlapping results and counts watched-to-watched once",()=>{
  const event=normalizeTransfer(log(),token);
  const report=buildReport({events:[event,event],config:exampleConfig,coverage:{status:"COMPLETE"}});
  assert.equal(report.summary.uniqueEvents,1);
  assert.equal(report.summary.significantEvents,1);
  assert.equal(report.events[0].direction,"INTERNAL");
  assert.equal(report.summary.tokens[token.address].internalRaw,"1000000");
  assert.equal(report.summary.tokens[token.address].netExternalRaw,"0");
});

test("separates external inflow, outflow, mint and burn",()=>{
  const external="0x1111111111111111111111111111111111111111";
  const cases=[
    [external,exampleConfig.addresses[0].address,"EXTERNAL_INFLOW"],
    [exampleConfig.addresses[0].address,external,"EXTERNAL_OUTFLOW"],
    [ZERO,exampleConfig.addresses[0].address,"MINT"],
    [exampleConfig.addresses[0].address,ZERO,"BURN"]
  ];
  cases.forEach(([from,to,direction],index)=>assert.equal(evaluateTransfers([normalizeTransfer(log({from,to,hash:String(index+2).repeat(64)}),token)],exampleConfig)[0].direction,direction));
});

test("threshold changes reevaluate the same immutable observations",()=>{
  const event=normalizeTransfer(log({amount:2_000_000n}),token);
  assert.equal(evaluateTransfers([event],exampleConfig)[0].evaluation,"SIGNIFICANT");
  const changed={...exampleConfig,tokens:[{...token,threshold:"3"}]};
  assert.equal(evaluateTransfers([event],changed)[0].evaluation,"BELOW_THRESHOLD");
  assert.equal(event.amountRaw,"2000000");
});

test("unknown destinations stay unlabeled and user labels retain provenance",()=>{
  const external="0x1111111111111111111111111111111111111111";
  const result=evaluateTransfers([normalizeTransfer(log({to:external}),token)],exampleConfig)[0];
  assert.equal(result.destinationLabel,"UNKNOWN / unlabeled");
  assert.equal(result.watchedFrom.labelSource,"USER_SUPPLIED");
});

test("pagination boundaries are gap-free and cursor remains caller-controlled on failure",()=>{
  assert.deepEqual(nextScanRange(null,2000,500),{fromBlock:1501,toBlock:2000});
  assert.deepEqual(nextScanRange(1000,2000,500),{fromBlock:1001,toBlock:1500});
  assert.deepEqual(nextScanRange(1500,2000,500),{fromBlock:1501,toBlock:2000});
  assert.equal(nextScanRange(2000,2000,500),null);
  assert.throws(()=>nextScanRange(0,2000,1001),/1 to 1000/);
});

test("CSV and JSON reports contain the same event identity and amount",()=>{
  const event=normalizeTransfer(log(),token); const report=buildReport({events:[event],config:exampleConfig,coverage:{status:"COMPLETE"}}); const csv=reportCsv(report);
  assert.match(csv,new RegExp(event.transactionHash)); assert.match(csv,/"1"/); assert.match(csv,/"1000000"/);
});
