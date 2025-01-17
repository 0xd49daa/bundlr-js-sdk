import type { Signer } from "arbundles";
import { NearSigner } from "arbundles";
import BigNumber from "bignumber.js";
import type { CurrencyConfig, Tx } from "../../common/types";
import BaseNodeCurrency from "../currency";
import { SCHEMA, Signature, SignedTransaction } from "@near-js/transactions";
import { actionCreators, createTransaction } from "@near-js/transactions";
import bs58 from "bs58";
import { serialize } from "borsh";
import BN from "bn.js";
import { sha256 } from "js-sha256";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPair } from "@near-js/crypto";

import { parseSeedPhrase, KEY_DERIVATION_PATH } from "near-seed-phrase";
import base64url from "base64url";
import axios from "axios";
export default class NearConfig extends BaseNodeCurrency {
  protected keyPair: KeyPair;

  protected declare providerInstance?: JsonRpcProvider;
  protected declare bundlrUrl: string;

  constructor(config: CurrencyConfig & { bundlrUrl: string }) {
    let wallet = config.wallet;
    if (typeof wallet === "string" && wallet?.split(":")?.[0] !== "ed25519") {
      wallet = parseSeedPhrase(wallet, KEY_DERIVATION_PATH).secretKey;
    }
    config.wallet = wallet;
    super(config);
    this.base = ["yoctoNEAR", 1e24];
    this.keyPair = KeyPair.fromString(this.wallet);
  }

  protected async getProvider(): Promise<JsonRpcProvider> {
    if (!this.providerInstance) {
      this.providerInstance = new JsonRpcProvider({ url: this.providerUrl });
    }
    return this.providerInstance;
  }

  /**
   * NEAR wants both the sender ID and tx Hash, so we have to concatenate to keep with the interface.
   * @param txId assumes format senderID:txHash
   */
  async getTx(txId: string): Promise<Tx> {
    // NOTE: their type defs are out of date with their actual API (23-01-2022)... beware the expect-error when debugging!
    const provider = await this.getProvider();
    const [id, hash] = txId.split(":");
    const status = await provider.txStatusReceipts(bs58.decode(hash), id);
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error

    const blockHeight = await provider.block(status.transaction_outcome.block_hash);
    const latestBlockHeight = (await provider.block({ finality: "final" })).header.height;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    if (status.receipts_outcome[0].outcome.status.SuccessValue !== "") {
      throw new Error("Transaction failed!");
    }
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const deposit = status.receipts[0].receipt.Action.actions[0].Transfer.deposit ?? 0;
    return {
      from: id,
      to: status.transaction.receiver_id,
      amount: new BigNumber(deposit),
      blockHeight: new BigNumber(blockHeight.header.height),
      pending: false,
      confirmed: latestBlockHeight - blockHeight.header.height >= this.minConfirm,
    };
  }

  /**
   * address = accountID
   * @param owner // assumed to be the "ed25519:" header + b58 encoded key
   */
  ownerToAddress(owner: any): string {
    return Buffer.from(typeof owner === "string" ? bs58.decode(owner.replace("ed25519:", "")) : bs58.decode(bs58.encode(owner))).toString("hex");
  }

  async sign(data: Uint8Array): Promise<Uint8Array> {
    return this.getSigner().sign(data);
  }

  getSigner(): Signer {
    return new NearSigner(this.wallet);
  }

  async verify(pub: any, data: Uint8Array, signature: Uint8Array): Promise<boolean> {
    return NearSigner.verify(pub, data, signature);
  }

  async getCurrentHeight(): Promise<BigNumber> {
    const provider = await this.getProvider();
    const res = await provider.status();
    return new BigNumber(res.sync_info.latest_block_height);
  }
  /**
   * NOTE: assumes only operation is transfer
   * @param _amount
   * @param _to
   * @returns
   */
  async getFee(_amount: BigNumber.Value, _to?: string): Promise<BigNumber> {
    // TODO: use https://docs.near.org/docs/concepts/gas and https://docs.near.org/docs/api/rpc/protocol#genesis-config
    // to derive cost from genesis config to generalise support.
    const provider = await this.getProvider();
    const res = await provider.gasPrice(null); // null == gas price as of latest block
    // multiply by action cost in gas units (assume only action is transfer)
    // 4.5x10^11 gas units for fund transfers
    return new BigNumber(res.gas_price).multipliedBy(450_000_000_000);
  }

  async sendTx(data: any): Promise<any> {
    data as SignedTransaction;
    const res = await (await this.getProvider()).sendTransaction(data);
    return `${this.address}:${res.transaction.hash}`; // encode into compound format
  }

  async createTx(
    amount: BigNumber.Value,
    to: string,
    _fee?: string,
  ): Promise<{
    tx: SignedTransaction;
    txId: undefined;
  }> {
    const provider = await this.getProvider();
    const accessKey = await provider.query({
      request_type: "view_access_key",
      finality: "final",
      account_id: this.address,
      public_key: this.keyPair.getPublicKey().toString(),
    });
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const nonce = ++accessKey.nonce;
    const recentBlockHash = Buffer.from(bs58.decode(accessKey.block_hash));
    const actions = [actionCreators.transfer(new BN(new BigNumber(amount).toFixed().toString()))];
    if (!this.address) throw new Error("Address is undefined - you might be missing a wallet, or have not run bundlr.ready()");
    const tx = createTransaction(this.address, this.keyPair.getPublicKey(), to, nonce, actions, recentBlockHash);
    const serialTx = serialize(SCHEMA, tx);
    const serialTxHash = new Uint8Array(sha256.array(serialTx));
    const signature = this.keyPair.sign(serialTxHash);
    const signedTx = new SignedTransaction({
      transaction: tx,
      signature: new Signature({
        keyType: tx.publicKey.keyType,
        data: signature.signature,
      }),
    });
    return { tx: signedTx, txId: undefined };
  }
  getPublicKey(): string | Buffer {
    this.keyPair = KeyPair.fromString(this.wallet);
    return Buffer.from(this.keyPair.getPublicKey().data);
  }

  async ready(): Promise<void> {
    try {
      // resolve loaded pubkey to parent address
      const pubkey = this.keyPair.getPublicKey().toString();
      const resolved = (await axios.get(`${this.bundlrUrl}account/near/lookup?address=${base64url.encode(pubkey.split(":")[1])}`).catch((e) => {
        return e;
      })) as any;
      this._address = resolved?.data?.address ?? this._address;
    } catch (e: any) {
      console.error(e);
    }
  }
}
