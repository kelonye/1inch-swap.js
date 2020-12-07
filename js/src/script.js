import * as qs from './qs';
import debug from './debug';

const INFURA_ID = process.env.INFURA_ID;
const IFRAME_HOST = process.env.IFRAME_HOST;

const ETH_ONE_INCH_ADDR = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const ONE_SPLIT_ADDRESS = '0xC586BeF4a0992C495Cf22e1aeEE4E446CECDee0E';
const ONE_SPLIT_DEXES = [
  'Uniswap',
  'Kyber',
  'Bancor',
  'Oasis',
  'CurveCompound',
  'CurveUsdt',
  'CurveY',
  'Binance',
  'Synthetix',
  'UniswapCompound',
  'UniswapChai',
  'UniswapAave',
];

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

    // validate `amount`
    defaultAmount = Number(defaultAmount);
    if (defaultAmount <= 0) throw new Error('invalid amount');

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

  async getHasSpendAllowance(assetAddress, decimals, amount) {
    if (assetAddress === ETH_ONE_INCH_ADDR) {
      return true;
    }

    const erc20Abi = await import('./abis/erc20.json');
    const fromAssetContract = new this.ethers.Contract(
      assetAddress,
      erc20Abi,
      this.ethersWallet
    );
    const allowance = await fromAssetContract.allowance(
      this.address,
      ONE_SPLIT_ADDRESS
    );
    const approve = await this.ethers.utils
      .parseEther(amount.toString(), decimals)
      .lte(allowance);
    debug('approval required: %s', approve);
    return approve;
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
        this.defaultProvider
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
        symbol: 'DAI',
        address: '0x6b175474e89094c44da98b954eedeac495271d0f',
        decimals: 18,
      },
      {
        symbol: 'UNI',
        address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
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

  async getQuote({
    fromAssetAddress,
    toAssetDecimals,
    fromAssetDecimals,
    toAssetAddress,
    fromAssetAmount,
  }) {
    const abi = await import('./abis/onesplit.json');
    const contract = new this.ethers.Contract(
      ONE_SPLIT_ADDRESS,
      abi,
      this.defaultProvider
    );
    return await contract.getExpectedReturn(
      fromAssetAddress,
      toAssetAddress,
      this.ethers.utils.parseUnits(
        fromAssetAmount.toString(),
        fromAssetDecimals
      ),
      100,
      0
    );
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
    const abi = await import('./abis/onesplit.json');
    const contract = new this.ethers.Contract(
      ONE_SPLIT_ADDRESS,
      abi,
      this.defaultProvider
    );
    const result = await contract.getExpectedReturn(
      toAssetAddress,
      fromAssetAddress,
      this.ethers.utils.parseUnits(toAssetAmount.toString(), toAssetDecimals),
      100,
      0
    );

    const fromAssetAmount = await this.ethers.utils.formatUnits(
      result.returnAmount,
      fromAssetDecimals
    );
    const fromAssetUsd = 600;
    const toAssetUsd = 600;
    const rate = toAssetAmount / fromAssetAmount;

    this.postMessageToIframe(sid, 'set-quote', {
      fromAssetAmount,
      fromAssetUsd,
      toAssetAmount,
      toAssetUsd,
      rate,
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
    const abi = await import('./abis/onesplit.json');
    const contract = new this.ethers.Contract(
      ONE_SPLIT_ADDRESS,
      abi,
      this.defaultProvider
    );
    const result = await contract.getExpectedReturn(
      fromAssetAddress,
      toAssetAddress,
      this.ethers.utils.parseUnits(
        fromAssetAmount.toString(),
        fromAssetDecimals
      ),
      100,
      0
    );

    const toAssetAmount = await this.ethers.utils.formatUnits(
      result.returnAmount,
      toAssetDecimals
    );
    const fromAssetUsd = 600;
    const toAssetUsd = 600;
    const rate = toAssetAmount / fromAssetAmount;

    this.postMessageToIframe(sid, 'set-quote', {
      fromAssetAmount,
      fromAssetUsd,
      toAssetAmount,
      toAssetUsd,
      rate,
      approve: !(await this.getHasSpendAllowance(
        fromAssetAddress,
        fromAssetDecimals,
        fromAssetAmount
      )),
    });
  }

  async onApprove(sid, { fromAssetAddress, fromAssetDecimals, amount }) {
    const value = await this.ethers.utils.parseEther(
      amount.toString(),
      fromAssetDecimals
    );
    const erc20Abi = await import('./abis/erc20.json');
    const fromAssetContract = new this.ethers.Contract(
      fromAssetAddress,
      erc20Abi,
      this.ethersWallet
    );
    try {
      const tx = await fromAssetContract.approve(ONE_SPLIT_ADDRESS, value);
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
      toEthereum,
      fromAssetAddress,
      fromAssetDecimals,
      toAssetAddress,
      toAssetDecimals,
      amount,
      address,
    }
  ) {
    const erc20Abi = await import('./abis/erc20.json');
    const fromAssetContract = new this.ethers.Contract(
      fromAssetAddress,
      erc20Abi,
      this.ethersWallet
    );
    const toAssetContract = new this.ethers.Contract(
      toAssetAddress,
      erc20Abi,
      this.ethersWallet
    );

    let fromBalanceBefore, toBalanceBefore;
    const fromEthereum = fromAssetAddress === ETH_ONE_INCH_ADDR;
    debug('from eth (%s) to eth(%s)', fromEthereum, toEthereum);
    if (fromEthereum) {
      fromBalanceBefore = await this.ethersWallet.getBalance();
      toBalanceBefore = await toAssetContract.balanceOf(address);
    } else if (toEthereum) {
      fromBalanceBefore = await fromAssetContract.balanceOf(address);
      toBalanceBefore = await this.ethersWallet.getBalance();
    } else {
      fromBalanceBefore = await fromAssetContract.balanceOf(address);
      toBalanceBefore = await toAssetContract.balanceOf(address);
    }

    // swap
    const quote = await this.getQuote({
      fromAssetAddress,
      toAssetDecimals,
      fromAssetDecimals,
      toAssetAddress,
      fromAssetAmount: amount,
    });
    const oneSplitAbi = await import('./abis/onesplit.json');
    const oneSplitContract = new this.ethers.Contract(
      ONE_SPLIT_ADDRESS,
      oneSplitAbi,
      this.ethersWallet
    );
    const value = await this.ethers.utils.parseEther(
      amount.toString(),
      toAssetDecimals
    );
    try {
      const tx = await oneSplitContract.swap(
        fromAssetAddress,
        toAssetAddress,
        value,
        quote.returnAmount,
        quote.distribution,
        0
      );
      // await tx.wait();
      // this.postMessageToIframe(sid, 'swaped', {
      //   transactionHash: tx.hash,
      // });
    } catch (err) {
      debug('error %s', err.message);
      // if (err.code === 4001) {
      //   this.onCancel();
      // } else {
      //   this.options.onError && this.options.onError(err);
      // }
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
      cacheProvider: true,
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
    web3Modal.clearCachedProvider();
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
