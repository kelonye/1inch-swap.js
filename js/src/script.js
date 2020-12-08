import * as qs from './qs';
import debug from './debug';

const INFURA_ID = process.env.INFURA_ID;
const IFRAME_HOST = process.env.IFRAME_HOST;

const PRECISION = 1e4;

const ETH_ONE_INCH_ADDR = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const ONE_SPLIT_ADDRESS = '1proto.eth'; // '1split.eth';

class Swap {
  constructor(options) {
    this.options = options;
    this.sid = Date.now();
    this.handleMessage = e => this.handleMessageBound(e);
    this.handleMessages();
    this.createIframe();
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

  onClose() {
    if (window.removeEventListener) {
      window.removeEventListener('message', this.handleMessage, false);
    } else {
      window.detachEvent('onmessage', this.handleMessage);
    }

    document.body.removeChild(this.iframe);
  }

  onCancel() {
    this.onClose();
    this.options.onCancel && this.options.onCancel();
  }

  getSigner() {
    return this.ethersWallet || this.defaultProvider;
  }

  async getQuote({ fromAssetAddress, toAssetAddress, fromAssetAmount }) {
    const oneSplitAbi = await import('./abis/onesplit.json');
    const oneSplitContract = new this.ethers.Contract(
      ONE_SPLIT_ADDRESS,
      oneSplitAbi,
      this.getSigner()
    );
    const quote = await oneSplitContract.getExpectedReturnWithGas(
      fromAssetAddress,
      toAssetAddress,
      fromAssetAmount,
      100,
      0,
      0
    );
    return { oneSplitContract, quote };
  }

  async getQuoteStats(quote) {
    return {
      fromAssetUsd: 600,
      toAssetUsd: 600,

      feeUSD: '2.5',
      feeIsHigh: false,
      priceImpact: '<0.01%',
      priceImpactIsHigh: false,
    };
  }

  async onGetFromAssets(sid, { toEthereum, toTokenAddress, defaultAmount }) {
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
      3;
      const abi = await import('./abis/erc20.json');
      const contract = new this.ethers.Contract(
        toTokenAddress,
        abi,
        this.getSigner()
      );
      toAsset.address = toTokenAddress;
      toAsset.symbol = (await contract.symbol()).toUpperCase();
      toAsset.decimals = await contract.decimals();
    }

    // const { tokens } = await request(
    //   'https://tokens.coingecko.com/uniswap/all.json'
    // );

    const fromAssets = [
      {
        symbol: 'UNI',
        address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
        decimals: 18,
      },
      {
        symbol: 'DAI',
        address: '0x6b175474e89094c44da98b954eedeac495271d0f',
        decimals: 18,
      },
      {
        symbol: 'ETH',
        address: ETH_ONE_INCH_ADDR,
        decimals: 18,
      },
    ];
    const fromAsset = fromAssets[0];

    this.postMessageToIframe(sid, 'set-from-assets', {
      fromAssets,
      toAsset,
    });

    // get initial quote in the reverse
    const toAssetAmount = defaultAmount || 1;
    await this.onGetInitialQuote(sid, {
      fromAssetAddress: fromAsset.address,
      fromAssetDecimals: fromAsset.decimals,
      toAssetAddress: toAsset.address,
      toAssetDecimals: toAsset.decimals,
      toAssetAmount,
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

    const { quote } = await this.getQuote({
      fromAssetAddress: toAssetAddress,
      toAssetAddress: fromAssetAddress,
      fromAssetAmount: toAssetAmount,
    });

    const fromAssetAmount = quote.returnAmount;
    const rate =
      toAssetAmount
        .mul(PRECISION)
        .div(fromAssetAmount)
        .toNumber() / PRECISION;

    this.postMessageToIframe(sid, 'set-quote', {
      fromAssetAmount: this.ethers.utils.formatUnits(
        fromAssetAmount,
        fromAssetDecimals
      ),
      toAssetAmount: this.ethers.utils.formatUnits(
        toAssetAmount,
        toAssetDecimals
      ),
      rate,
      ...(await this.getQuoteStats(quote)),
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

    const { quote } = await this.getQuote({
      fromAssetAddress,
      toAssetAddress,
      fromAssetAmount,
    });

    const toAssetAmount = quote.returnAmount;
    const rate =
      fromAssetAmount
        .mul(PRECISION)
        .div(toAssetAmount)
        .toNumber() / PRECISION;

    let hasSufficientBalance = false;
    let approve = false;

    if (this.address) {
      let balance;
      if (fromAssetAddress === ETH_ONE_INCH_ADDR) {
        balance = await this.ethersWallet.getBalance();
      } else {
        const erc20Abi = await import('./abis/erc20.json');
        const fromAssetContract = new this.ethers.Contract(
          fromAssetAddress,
          erc20Abi,
          this.getSigner()
        );
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

    this.postMessageToIframe(sid, 'set-quote', {
      fromAssetAmount: this.ethers.utils.formatUnits(
        fromAssetAmount,
        fromAssetDecimals
      ),
      toAssetAmount: this.ethers.utils.formatUnits(
        toAssetAmount,
        toAssetDecimals
      ),
      rate,
      hasSufficientBalance,
      approve,
      ...(await this.getQuoteStats(quote)),
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

    const erc20Abi = await import('./abis/erc20.json');
    const fromAssetContract = new this.ethers.Contract(
      fromAssetAddress,
      erc20Abi,
      this.getSigner()
    );
    try {
      const tx = await fromAssetContract.approve(
        ONE_SPLIT_ADDRESS,
        fromAssetAmount
      );
      await tx.wait();
      this.postMessageToIframe(sid, 'approved');
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

    // const erc20Abi = await import('./abis/erc20.json');
    // const fromAssetContract = new this.ethers.Contract(
    //   fromAssetAddress,
    //   erc20Abi,
    //   this.getSigner()
    // );
    // const toAssetContract = new this.ethers.Contract(
    //   toAssetAddress,
    //   erc20Abi,
    //   this.getSigner()
    // );

    // let fromBalanceBefore, toBalanceBefore;
    const fromEthereum = fromAssetAddress === ETH_ONE_INCH_ADDR;
    const toEthereum = toAssetAddress === ETH_ONE_INCH_ADDR;
    // debug('from eth (%s) to eth(%s)', fromEthereum, toEthereum);
    // if (fromEthereum) {
    //   fromBalanceBefore = await this.ethersWallet.getBalance();
    //   toBalanceBefore = await toAssetContract.balanceOf(address);
    // } else if (toEthereum) {
    //   fromBalanceBefore = await fromAssetContract.balanceOf(address);
    //   toBalanceBefore = await this.ethersWallet.getBalance();
    // } else {
    //   fromBalanceBefore = await fromAssetContract.balanceOf(address);
    //   toBalanceBefore = await toAssetContract.balanceOf(address);
    // }

    // swap
    const { oneSplitContract, quote } = await this.getQuote({
      fromAssetAddress,
      toAssetAddress,
      fromAssetAmount,
    });

    try {
      const tx = await oneSplitContract.swap(
        fromAssetAddress,
        toAssetAddress,
        fromAssetAmount,
        quote.returnAmount,
        quote.distribution,
        0x04,
        fromEthereum ? { value: fromAssetAmount } : {}
      );
      // await tx.wait();
      this.postMessageToIframe(sid, 'swaped', {
        transactionHash: tx.hash,
      });
    } catch (err) {
      debug('error %s', err.message);
      this.postMessageToIframe(sid, 'error', err);
    }
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
    this.postMessageToIframe(sid, 'connected', { address });
    this.showIframe(true);
  }

  async onComplete(sid, { transactionHash }) {
    if (this.options.onSwap) {
      this.options.onSwap(transactionHash);
    } else {
      this.onClose();
    }
  }

  async onError(sid, error) {
    this.options.onError(new Error(error));
  }

  handleMessages() {
    if (window.addEventListener) {
      window.addEventListener('message', this.handleMessage, false);
    } else {
      window.attachEvent('onmessage', this.handleMessage);
    }
  }

  handleMessageBound(evt) {
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
    switch (msg.type) {
      case 'error': {
        this.onError(msg.sid, msg.payload);
        break;
      }

      case 'get-from-assets': {
        this.onGetFromAssets(msg.sid, msg.payload);
        break;
      }

      case 'connect-wallet': {
        this.onConnectWallet(msg.sid, msg.payload);
        break;
      }

      case 'get-quote': {
        this.onGetQuote(msg.sid, msg.payload);
        break;
      }

      case 'approve': {
        this.onApprove(msg.sid, msg.payload);
        break;
      }

      case 'swap': {
        this.onSwap(msg.sid, msg.payload);
        break;
      }

      case 'complete': {
        this.onComplete(msg.sid, msg.payload);
        break;
      }

      case 'cancel': {
        this.onCancel(msg.sid, msg.payload);
        break;
      }

      default:
        debug('unknown msg type');
    }
  }

  postMessageToIframe(sid, type, payload = {}) {
    this.iframe.contentWindow.postMessage(
      JSON.stringify({ type, payload, sid }),
      IFRAME_HOST
    );
  }
}

async function request(url) {
  return await (await fetch(url)).json();
}

window.oneInch = function(options) {
  debug('swap');
  const swap = new Swap(options);
  return () => swap.onClose.call(swap);
};
