import Api from "../common/api";
import Bundlr from "../common/bundlr";
import Fund from "../common/fund";
import type { BundlrConfig, CreateAndUploadOptions, UploadResponse } from "../common/types";
import Utils from "../common/utils";
import getCurrency from "./currencies/index";
import type { NodeCurrency } from "./types";
import NodeUploader from "./upload";
import * as arbundles from "./utils";

export default class NodeBundlr extends Bundlr {
  public uploader: NodeUploader; // re-define type
  public currencyConfig: NodeCurrency;

  /**
   * Constructs a new Bundlr instance, as well as supporting subclasses
   * @param url - URL to the bundler
   * @param wallet - private key (in whatever form required)
   */
  constructor(url: string, currency: string, wallet?: any, config?: BundlrConfig) {
    const parsed = new URL(url);
    super(parsed, arbundles);
    if (parsed.host === "devnet.bundlr.network" && !config?.providerUrl)
      throw new Error(
        `Using ${parsed.host} requires a dev/testnet RPC to be configured! see https://docs.bundlr.network/developer-docs/using-devnet`,
      );
    this.api = new Api({
      protocol: parsed.protocol.slice(0, -1),
      port: parsed.port,
      host: parsed.hostname,
      timeout: config?.timeout ?? 100000,
      headers: config?.headers,
    });
    this.currencyConfig = getCurrency(
      this,
      currency.toLowerCase(),
      wallet,
      parsed.toString(),
      config?.providerUrl,
      config?.contractAddress,
      config?.currencyOpts,
    );
    this.currency = this.currencyConfig.name;
    this.address = this.currencyConfig.address;
    this.utils = new Utils(this.api, this.currency, this.currencyConfig);
    this.funder = new Fund(this.utils);
    this.uploader = new NodeUploader(this.api, this.utils, this.currency, this.currencyConfig);
    this._readyPromise = this.currencyConfig.ready ? this.currencyConfig.ready() : new Promise((r) => r());
  }

  /**
   * Upload a file at the specified path to the bundler
   * @param path path to the file to upload
   * @returns bundler response
   */
  async uploadFile(path: string, opts?: CreateAndUploadOptions): Promise<UploadResponse> {
    return this.uploader.uploadFile(path, opts);
  }

  /**
   * @param path - path to the folder to be uploaded
   * @param indexFile - path to the index file (i.e index.html)
   * @param batchSize - number of items to upload concurrently
   * @param interactivePreflight - whether to interactively prompt the user for confirmation of upload (CLI ONLY)
   * @param keepDeleted - Whether to keep previously uploaded (but now deleted) files in the manifest
   * @param logFunction - for handling logging from the uploader for UX
   * @param manifestTags - For allowing the caller to pass tags that will be added to the manifest transaction.
   * @returns
   */
  public async uploadFolder(
    path: string,
    {
      batchSize = 10,
      keepDeleted = true,
      indexFile,
      interactivePreflight,
      logFunction,
      manifestTags,
    }: {
      batchSize?: number;
      keepDeleted?: boolean;
      indexFile?: string;
      interactivePreflight?: boolean;
      logFunction?: (log: string) => Promise<void>;
      manifestTags?: { name: string; value: string }[];
    } = {},
  ): Promise<UploadResponse | undefined> {
    return this.uploader.uploadFolder(path, { indexFile, batchSize, interactivePreflight, keepDeleted, logFunction, manifestTags });
  }
  public static async init(opts: {
    url: string;
    currency: string;
    privateKey?: string;
    publicKey?: string;
    signingFunction?: (msg: Uint8Array) => Promise<Uint8Array>;
    collectSignatures?: (msg: Uint8Array) => Promise<{ signatures: string[]; bitmap: number[] }>;
    providerUrl?: string;
    timeout?: number;
    contractAddress?: string;
  }): Promise<NodeBundlr> {
    const { url, currency, privateKey, publicKey, signingFunction, collectSignatures, providerUrl, timeout, contractAddress } = opts;
    const bundlr = new NodeBundlr(url, currency, signingFunction ? publicKey : privateKey, {
      providerUrl,
      timeout,
      contractAddress,
      currencyOpts: { signingFunction, collectSignatures },
    });
    await bundlr.ready();
    return bundlr;
  }
}
