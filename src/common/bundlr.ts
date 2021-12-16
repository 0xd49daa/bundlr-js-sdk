import Utils from "./utils";
import { withdrawBalance } from "./withdrawal";
import Uploader from "./upload";
import Fund from "./fund";
import { AxiosResponse } from "axios";
import { Currency } from "./currencies";
import { DataItemCreateOptions } from "arbundles";
import BundlrTransaction from "./transaction";
import Api from "./api";
import BigNumber from "bignumber.js";

let currencies;

export let arweave;
export const keys: { [key: string]: { key: string, address: string } } = {};


export default abstract class Bundlr {
    public api: Api;
    public utils: Utils;
    public uploader: Uploader;
    public funder: Fund;
    public address;
    public currency;
    public wallet;
    public currencyConfig: Currency;

    /**
     * Constructs a new Bundlr instance, as well as supporting subclasses
     * @param url - URL to the bundler
     * @param wallet - any data/object that subsequent currency code requires for cryptographic functions. can be a key, a web3 provider, etc.
     */
    constructor(url: string, currency: string, wallet?: any) {
        // hacky for the moment...
        // specifically about ordering - some stuff here seems silly but leave it for now it works
        console.log(`loading currency ${currency}`)
        console.log(`wallet is: ${Object.keys(wallet)}`)

        this.currency = currency;
        if (!wallet) {
            wallet = "default";
        }
        keys[currency] = { key: wallet, address: undefined };
        this.wallet = wallet;
        const parsed = new URL(url);
        this.api = new Api({ protocol: parsed.protocol.slice(0, -1), port: parsed.port, host: parsed.hostname });
        // if (currency === "arweave") {
        //     //arweave = new Arweave(this.api.getConfig());
        //     arweave = Arweave.init({ host: "arweave.net", protocol: "https", port: 443 });
        // }
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        currencies = (require("./currencies/index")).currencies; //delay so that keys object can be properly constructed
        if (!currencies[currency]) {
            throw new Error(`Unknown/Unsuported currency ${currency}`);
        }
        this.currencyConfig = currencies[currency];

        this.currencyConfig.account.address = this.address;
        //this.address = address;
        this.utils = new Utils(this.api, this.currency, this.currencyConfig);
        // this.withdrawBalance = async (amount: number) => await withdrawBalance(this.utils, this.api, wallet, amount);
        this.uploader = new Uploader(this.api, currency, this.currencyConfig);
        // this.upload = this.uploader.upload; note to self: don't do this, this destorys 'this' scoping for instantiated subclasses
        this.funder = new Fund(this.utils);

    }
    async withdrawBalance(amount: BigNumber): Promise<AxiosResponse<any>> {
        return await withdrawBalance(this.utils, this.api, amount);
    }

    /**
     * Gets the balance for the loaded wallet
     * @returns balance (in winston)
     */
    async getLoadedBalance(): Promise<BigNumber> {
        return this.utils.getBalance(this.address)
    }
    /**
     * Gets the balance for the specified address
     * @param address address to query for
     * @returns the balance (in winston)
     */
    async getBalance(address: string): Promise<BigNumber> {
        return this.utils.getBalance(address)
    }
    /**
     * Sends amount winston to the specified bundler
     * @param amount amount to send in winston
     * @returns Arweave transaction
     */
    async fund(amount: BigNumber, multiplier?: number): Promise<any> {
        return this.funder.fund(amount, multiplier)
    }

    /**
     * Create a new BundlrTransactions (flex currency arbundles dataItem)
     * @param data 
     * @param opts - dataItemCreateOptions
     * @returns - a new BundlrTransaction instance
     */
    createTransaction(data: string | Uint8Array, opts?: DataItemCreateOptions): BundlrTransaction {
        return new BundlrTransaction(data, this, opts);
    }
}