/**
 * Runtime wiring: turn an {@link AutomationConfig} into the concrete dependencies the jobs
 * need (chain client, price source, provisioner/discovery, settler, alerter, logger). The
 * CLI entrypoints call these so the `bin/*` files stay thin.
 */

import { Connection } from "@solana/web3.js";
import type { AutomationConfig } from "./config";
import { PriceSourceKind } from "./config";
import { RpcChainClient, type ChainClient } from "./chain";
import {
  MockPriceSource,
  PythPriceSource,
  type PriceSource,
} from "./priceSource";
import { SdkMarketProvisioner, SdkMarketDiscovery } from "./markets";
import { PythSettler } from "./settler";
import { makeAlerter, type Alerter } from "./alerter";
import { createLogger, type Logger } from "./logger";

export interface Runtime {
  config: AutomationConfig;
  logger: Logger;
  alerter: Alerter;
  chain: ChainClient;
  priceSource: PriceSource;
}

/** Build the shared runtime (connection, chain client, logger, alerter, price source). */
export function buildRuntime(config: AutomationConfig): Runtime {
  const logger = createLogger();
  const alerter = makeAlerter({ webhookUrl: config.alertWebhookUrl, logger });
  const connection = new Connection(config.rpcUrl, "confirmed");
  const chain = new RpcChainClient(connection, config.keypair);

  const priceSource: PriceSource =
    config.priceSourceKind === PriceSourceKind.Pyth
      ? new PythPriceSource({
          feedIds: config.feedIds,
          hermesUrl: config.hermesUrl,
        })
      : new MockPriceSource(config.mockPrices);

  return { config, logger, alerter, chain, priceSource };
}

/** The morning-job dependency bundle built from a runtime. */
export function morningDeps(rt: Runtime) {
  return {
    tickers: rt.config.tickers,
    priceSource: rt.priceSource,
    provisioner: new SdkMarketProvisioner(rt.chain, rt.config.usdcMint),
    alerter: rt.alerter,
    logger: rt.logger,
    includeClose: rt.config.includeClose,
  };
}

/** The settlement-job dependency bundle built from a runtime. */
export function settlementDeps(rt: Runtime) {
  return {
    discovery: new SdkMarketDiscovery(rt.chain),
    settler: new PythSettler({
      chain: rt.chain,
      feedIds: rt.config.feedIds,
      hermesUrl: rt.config.hermesUrl,
    }),
    alerter: rt.alerter,
    logger: rt.logger,
  };
}
