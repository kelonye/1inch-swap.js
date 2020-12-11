import _camelCase from 'lodash/camelCase';
import _keyBy from 'lodash/keyBy';
import _bindAll from 'lodash/bindAll';
import bign from 'big.js';
import * as qs from './qs';
import debug from './debug';

const INFURA_ID = process.env.INFURA_ID;
const IFRAME_HOST = process.env.IFRAME_HOST;
const PRECISION = 4;
const ETH_ONE_INCH_ADDR = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const ONE_SPLIT_ADDRESS = '1proto.eth'; // '1split.eth';
const SLIPPAGE = 1;

class Swap {
  constructor(options) {
    _bindAll(this, 'handleMessage', 'getAssetCoinGeckoId');

    this.options = options;
    this.sid = Date.now();
    this.handleMessages();
    this.createIframe();
  }

  handleMessages() {
    if (window.addEventListener) {
      window.addEventListener('message', this.handleMessage, false);
    } else {
      window.attachEvent('onmessage', this.handleMessage);
    }
  }

  close() {
    if (window.removeEventListener) {
      window.removeEventListener('message', this.handleMessage, false);
    } else {
      window.detachEvent('onmessage', this.handleMessage);
    }

    document.body.removeChild(this.iframe);
  }

  handleMessage(evt) {
    let msg;
    try {
      msg = JSON.parse(evt.data);
    } catch {
      return;
    }
    debug('msg: %s', msg.sid);
    if (parseInt(msg.sid) !== parseInt(this.sid)) {
      return debug('ignoring msg(%s) self(%s)', msg.sid, this.sid);
    }
    debug('msg %o', msg);
    const meth = _camelCase('on-' + msg.type);
    if (!this[meth]) return debug('unknown msg type %s', meth);
    this[meth](msg.sid, msg.payload);
  }

  postMessageToIframe(sid, type, payload = {}) {
    this.iframe.contentWindow.postMessage(
      JSON.stringify({ type, payload, sid }),
      IFRAME_HOST
    );
  }

  validateOptions({ toEthereum, toTokenAddress, defaultAmount }) {
    // todo: validate `toTokenAddress`

    // validate `defaultAmount`
    defaultAmount = Number(defaultAmount);
    if (defaultAmount <= 0) throw new Error('invalid default amount');

    return {
      toEthereum,
      toTokenAddress,
      defaultAmount,
    };
  }

  createIframe() {
    const { sid, options } = this;

    try {
      const url =
        IFRAME_HOST +
        '?' +
        qs.stringify({
          options: btoa(
            JSON.stringify({
              sid,
              host: location.origin,
              ...this.validateOptions(options),
            })
          ),
        });

      debug(url);

      const iframe = (this.iframe = document.createElement('iframe'));
      iframe.setAttribute('src', url);
      iframe.style.display = 'flex';
      iframe.style.position = 'fixed';
      iframe.style.top = '0';
      iframe.style.left = '0';
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = 'none';
      iframe.style['z-index'] = '1000000000';
      // iframe.style.opacity = '0';
      // iframe.style['pointer-events'] = 'none';

      document.body.appendChild(iframe);
    } catch (e) {
      this.options.onError && this.options.onError(e);
    }
  }

  showIframe(show) {
    this.iframe.style.display = show ? 'flex' : 'none';
  }

  getSigner() {
    return this.ethersWallet || this.defaultProvider;
  }

  async getERC20Contract(address) {
    const erc20Abi = await import('./abis/erc20.json');
    return new this.ethers.Contract(address, erc20Abi, this.getSigner());
  }

  toFixed(a, b) {
    if (this.isZero(bign(a)) || this.isZero(bign(b))) {
      return '0';
    }
    return bign(a.toString())
      .div(bign(b.toString()))
      .toFixed(PRECISION);
  }

  formatUnits(a, decimals) {
    return this.toFixed(a.toString(), bign(10).pow(decimals));
  }

  isZero(a) {
    return a.eq(bign('0'));
  }

  // bn.js
  bn(a) {
    return this.ethers.BigNumber.from(a.toString());
  }

  async getQuote({ fromAssetAddress, toAssetAddress, fromAssetAmount }) {
    const { toTokenAmount, estimatedGas } = await request(
      'https://api.1inch.exchange/v2.0/quote',
      {
        fromTokenAddress: fromAssetAddress,
        toTokenAddress: toAssetAddress,
        amount: fromAssetAmount.toString(),
      }
    );
    return {
      toAssetAmount: this.bn(toTokenAmount),
      estimatedGas,
    };
  }

  async getQuoteStats({
    fromAssetAddress,
    fromAssetDecimals,
    fromAssetAmount,

    toAssetAddress,
    toAssetDecimals,
    toAssetAmount,
  }) {
    const assetsCoinGeckoIds = [fromAssetAddress, toAssetAddress].map(
      this.getAssetCoinGeckoId
    );
    const prices = await request(
      'https://api.coingecko.com/api/v3/simple/price',
      {
        ids: assetsCoinGeckoIds.join(','),
        vs_currencies: 'usd',
      }
    );
    debug('%o %o', assetsCoinGeckoIds, prices);

    const fromAssetUsd = this.getAssetAmountToUSD({
      assetAddress: fromAssetAddress,
      assetDecimals: fromAssetDecimals,
      amount: fromAssetAmount,
      usd: prices[assetsCoinGeckoIds[0]].usd,
    });
    const toAssetUsd = this.getAssetAmountToUSD({
      assetAddress: toAssetAddress,
      assetDecimals: toAssetDecimals,
      amount: toAssetAmount,
      usd: prices[assetsCoinGeckoIds[1]].usd,
    });

    return {
      fromAssetUsd,
      toAssetUsd,

      feeUSD: '-',
      feeIsHigh: false,
      priceImpact: '-', // '<0.01%',
      priceImpactIsHigh: false,
    };
  }

  getAssetCoinGeckoId(assetAddress) {
    return assetAddress === ETH_ONE_INCH_ADDR
      ? 'ethereum'
      : this.fromAssetsRegistry[assetAddress].id;
  }

  getAssetAmountToUSD({ assetAddress, assetDecimals, amount, usd }) {
    return this.formatUnits(
      bign(amount.toString()).mul(bign(usd.toString())),
      assetDecimals
    );
  }

  // messages from js

  async onError(sid, error) {
    this.options.onError(new Error(error));
  }

  onCancel() {
    this.close();
    this.options.onCancel && this.options.onCancel();
  }

  async onConnectWallet(sid) {
    const { default: Web3Modal } = await import('web3modal');
    const { default: MewConnect } = await import(
      '@myetherwallet/mewconnect-web-client'
    );
    const { default: WalletConnectProvider } = await import(
      '@walletconnect/web3-provider'
    );

    this.showIframe(false);

    const web3Modal = new Web3Modal({
      cacheProvider: true, // todo: provide a way for user to disconnect
      providerOptions: {
        mewconnect: {
          package: MewConnect,
          options: {
            infuraId: INFURA_ID,
          },
        },
        walletconnect: {
          package: WalletConnectProvider,
          options: {
            infuraId: INFURA_ID,
          },
        },
      },
    });

    this.web3Provider = await web3Modal.connect();
    this.web3Provider.on('accountsChanged', () => {});
    this.web3Provider.on('chainChanged', () => {});

    this.ethersProvider = new this.ethers.providers.Web3Provider(
      this.web3Provider
    );
    this.ethersWallet = this.ethersProvider.getSigner();
    const address = (this.address = await this.ethersWallet.getAddress());
    this.postMessageToIframe(sid, 'connect', { address });
    this.showIframe(true);
  }

  async onIframeLoad(sid, { toEthereum, toTokenAddress }) {
    const { ethers } = await import('ethers');
    this.ethers = ethers;
    this.defaultProvider = new ethers.providers.InfuraProvider(
      'homestead',
      INFURA_ID
    );

    const toAsset = {};
    if (toEthereum) {
      toAsset.symbol = 'ETH';
      toAsset.address = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
      toAsset.decimals = 18;
      toAsset.isETH = true;
    } else {
      const erc20Contract = await this.getERC20Contract(toTokenAddress);
      toAsset.address = toTokenAddress;
      toAsset.symbol = (await erc20Contract.symbol()).toUpperCase();
      toAsset.decimals = await erc20Contract.decimals();
    }

    //const fromAssets = (await request('https://api.1inch.exchange/v2.0/tokens')).map;

    const fromAssets = [
      {
        id: 'dai',
        symbol: 'DAI',
        address: '0x6b175474e89094c44da98b954eedeac495271d0f',
        decimals: 18,
      },
      {
        id: 'uniswap',
        symbol: 'UNI',
        address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
        decimals: 18,
      },
      {
        id: 'ethereum',
        symbol: 'ETH',
        address: ETH_ONE_INCH_ADDR,
        decimals: 18,
      },
    ];
    this.fromAssetsRegistry = _keyBy(fromAssets, 'address');

    this.postMessageToIframe(sid, 'iframe-load', {
      fromAssets,
      toAsset,
    });
  }

  async onGetInitialQuote(
    sid,
    {
      fromAssetAddress,
      toAssetDecimals,
      fromAssetDecimals,
      toAssetAddress,
      toAssetAmount,
    }
  ) {
    toAssetAmount = this.ethers.utils.parseUnits(
      toAssetAmount.toString(),
      toAssetDecimals
    );

    const { toAssetAmount: fromAssetAmount } = await this.getQuote({
      fromAssetAddress: toAssetAddress,
      toAssetAddress: fromAssetAddress,
      fromAssetAmount: toAssetAmount,
    });

    const rate = this.toFixed(toAssetAmount, fromAssetAmount);

    this.postMessageToIframe(sid, 'get-quote', {
      fromAssetAmount: this.formatUnits(fromAssetAmount, fromAssetDecimals),
      toAssetAmount: this.formatUnits(toAssetAmount, toAssetDecimals),
      rate,
      ...(await this.getQuoteStats({
        fromAssetAddress,
        fromAssetDecimals,
        fromAssetAmount,

        toAssetAddress,
        toAssetDecimals,
        toAssetAmount,
      })),
    });
  }

  async onGetQuote(
    sid,
    {
      fromAssetAddress,
      toAssetDecimals,
      fromAssetDecimals,
      toAssetAddress,
      fromAssetAmount,
    }
  ) {
    fromAssetAmount = this.ethers.utils.parseUnits(
      fromAssetAmount.toString(),
      fromAssetDecimals
    );

    const { toAssetAmount } = await this.getQuote({
      fromAssetAddress,
      toAssetAddress,
      fromAssetAmount,
    });

    const rate = this.toFixed(toAssetAmount, fromAssetAmount);

    let hasSufficientBalance = false;
    let approve = false;
    let balance;

    if (this.address) {
      if (fromAssetAddress === ETH_ONE_INCH_ADDR) {
        balance = await this.ethersWallet.getBalance();
      } else {
        const fromAssetContract = await this.getERC20Contract(fromAssetAddress);
        balance = await fromAssetContract.balanceOf(this.address);
        const allowance = await fromAssetContract.allowance(
          this.address,
          ONE_SPLIT_ADDRESS
        );
        approve = fromAssetAmount.gt(allowance);
      }

      hasSufficientBalance = balance.gte(fromAssetAmount);

      debug('approval required: %s', approve);
      debug('has sufficient balance: %s', hasSufficientBalance);
    }

    this.postMessageToIframe(sid, 'get-quote', {
      fromAssetAmount: this.formatUnits(fromAssetAmount, fromAssetDecimals),
      toAssetAmount: this.formatUnits(toAssetAmount, toAssetDecimals),
      rate,
      fromAssetBalance: !balance
        ? null
        : this.formatUnits(balance, fromAssetDecimals),
      hasSufficientBalance,
      approve,
      ...(await this.getQuoteStats({
        fromAssetAddress,
        fromAssetDecimals,
        fromAssetAmount,

        toAssetAddress,
        toAssetDecimals,
        toAssetAmount,
      })),
    });
  }

  async onApprove(
    sid,
    { fromAssetAddress, fromAssetDecimals, fromAssetAmount }
  ) {
    fromAssetAmount = this.ethers.utils
      .parseUnits(fromAssetAmount.toString(), fromAssetDecimals)
      .mul(101)
      .div(100);

    const fromAssetContract = await this.getERC20Contract(fromAssetAddress);
    try {
      const tx = await fromAssetContract.approve(
        ONE_SPLIT_ADDRESS,
        fromAssetAmount
      );
      await tx.wait();
      this.postMessageToIframe(sid, 'approve');
    } catch (err) {
      debug('error %s', err.message);
      this.postMessageToIframe(sid, 'error', err);
    }
  }

  async onSwap(
    sid,
    {
      fromAssetAddress,
      fromAssetDecimals,
      toAssetAddress,
      toAssetDecimals,
      fromAssetAmount,
      address,
    }
  ) {
    fromAssetAmount = this.ethers.utils.parseUnits(
      fromAssetAmount.toString(),
      fromAssetDecimals
    );

    try {
      const {
        tx: {
          from,
          to,
          data,
          value,
          // gasPrice,
          // gas
        },
      } = await request('https://api.1inch.exchange/v2.0/swap', {
        fromTokenAddress: fromAssetAddress,
        toTokenAddress: toAssetAddress,
        amount: fromAssetAmount.toString(),
        fromAddress: this.address,
        slippage: SLIPPAGE,
      });
      const tx = await this.ethersWallet.sendTransaction({
        from,
        to,
        data,
        value: this.bn(value),
        // gasPrice,
        // gas
      });
      this.postMessageToIframe(sid, 'swap', {
        transactionHash: tx.hash,
      });
    } catch (err) {
      debug('error %s', err.message);
      this.postMessageToIframe(sid, 'error', err);
    }
  }

  async onComplete(sid, { transactionHash }) {
    if (this.options.onSwap) {
      this.options.onSwap(transactionHash);
    } else {
      this.close();
    }
  }
}

async function request(url, query) {
  if (query) {
    url += '?' + qs.stringify(query);
  }
  return await (await fetch(url)).json();
}

window.oneInch = function(options) {
  debug('swap');
  const swap = new Swap(options);
  return () => swap.close.call(swap);
};
