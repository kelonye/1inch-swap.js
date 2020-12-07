import debug from './debug';
import * as qs from './qs';
import * as dom from './dom';

window.onload = () => new Swap();

class Swap {
  constructor() {
    const querystring = qs.parse(window.location.search.substring(1));
    this.props = JSON.parse(atob(unescape(querystring.options)));
    debug('props %o', this.props);

    this.addressLabel = document.getElementById('address');
    this.form = document.querySelector('form');
    this.button = document.querySelector('button');
    this.close = document.getElementById('close');
    this.loader = document.getElementById('boot-loader-container');

    this.fromAssetContainer = document.querySelector('.from-asset');
    this.fromAssetAmountInput = this.fromAssetContainer.querySelector('input');
    this.fromAssetSelect = this.fromAssetContainer.querySelector('select');
    this.fromBalance = this.fromAssetContainer.querySelector('.balance');
    this.fromAssetUSDEstimate = this.fromAssetContainer.querySelector('.usd');

    this.toAssetContainer = document.querySelector('.to-asset');
    this.toAssetAmountInput = this.toAssetContainer.querySelector('input');
    this.toAssetSelect = this.toAssetContainer.querySelector('select');
    this.toAssetUSDEstimate = this.toAssetContainer.querySelector('.usd');

    this.quoteRate = document.getElementById('quote-rate');
    this.quotePriceImpact = document.getElementById('quote-price-impact');
    this.quoteFee = document.getElementById('quote-fee');

    this.setUpEventHandlers();
    this.loadFromAssets();
  }

  setUpEventHandlers() {
    this.handleMessage = e => this.handleMessageBound(e);
    this.handleMessages();

    this.fromAssetAmountInput.oninput = e => this.onAmountChange(e);
    this.fromAssetSelect.onchange = e => this.onAssetChange(e);

    this.form.onsubmit = e => this.connectWalletOrApproveOrSwap(e);

    this.close.onclick = () => this.postMessageToParentWindow('cancel');
  }

  loadFromAssets() {
    this.postMessageToParentWindow('get-from-assets', this.props);
  }

  onLoadFromAssets({ fromAssets, toAsset }) {
    const fromAsset = fromAssets[0];
    this.fromAsset = fromAsset;
    this.fromAssets = fromAssets;
    this.fromAssetSelect.innerHTML = fromAssets
      .map(({ symbol }, i) => `<option value=${i}>${symbol}</option>`)
      .join('');
    this.fromAssetSelect.value = 0;

    this.toAsset = toAsset;
    this.toAssetSelect.innerHTML = `<option>${this.toAsset.symbol}</option>`;
    this.toAssetAmountInput.value = this.toAsset.symbol;

    dom.hide(this.loader);
    dom.show(this.form);
  }

  onSetBalance(balance) {
    this.fromBalance.querySelector('span').innerText = balance;
    dom.show(this.fromBalance);
  }

  onAmountChange(e) {
    this.fromAssetAmount = parseFloat(e.target.value);
    if (!this.fromAssetAmount) {
      this.toAssetAmountInput.value = '0';
      return;
    }
    this.updateQuote();
  }

  onAssetChange(e) {
    this.fromAsset = this.fromAssets[parseInt(e.target.value)];
    this.updateQuote();
  }

  setButtonText(text) {
    this.button.innerHTML = text;
  }

  updateQuote() {
    this.postMessageToParentWindow('get-quote', {
      fromAssetAddress: this.fromAsset.address,
      fromAssetDecimals: this.fromAsset.decimals,
      toAssetAddress: this.toAsset.address,
      toAssetDecimals: this.toAsset.decimals,
      fromAssetAmount: this.fromAssetAmount,
    });
  }

  onUpdateQuote({
    fromAssetAmount,
    fromAssetUsd,
    toAssetUsd,
    toAssetAmount,
    rate,
    approve,
    hasSufficientBalance,
  }) {
    if (!this.fromAssetAmount) {
      this.fromAssetAmountInput.value = this.fromAssetAmount = fromAssetAmount;
    }
    this.fromAssetUSDEstimate.innerText = `≈ $${fromAssetUsd}`;

    this.toAssetAmountInput.value = toAssetAmount;
    this.toAssetUSDEstimate.innerText = `≈ ${toAssetUsd}`;

    this.quoteRate.innerText = `1 ${this.fromAsset.symbol} = ${rate} ${this.toAsset.symbol}`;
    this.quotePriceImpact.innerText = `>0.01%`;
    this.quotePriceImpact.classList.add('red');
    this.quoteFee.innerText = `≈ $2.6`;
    this.quoteFee.classList.add('red');

    this.approve = approve;

    dom.attr(this.button, 'disabled', this.address && !hasSufficientBalance);

    if (!this.address) {
      this.setButtonText('Connect Wallet');
    } else if (!hasSufficientBalance) {
      this.setButtonText('Insufficent Balance');
    } else if (approve) {
      this.setButtonText(`Approve ${this.fromAsset.symbol}`);
    } else if (this.address) {
      this.setButtonText('Swap →');
    }
  }

  async onApproved() {
    this.setIsWorking(false);
    this.updateQuote();
  }

  async onSwapped(props) {
    this.setIsWorking(false);

    this.setButtonText(
      'Swaped <span class="pl-2" style="font-family: none;">✓</span>'
    );
    await sleep(3000);
    this.postMessageToParentWindow('complete', props);
  }

  connectWalletOrApproveOrSwap(e) {
    e.preventDefault();
    e.stopPropagation();

    if (!this.address) {
      debug('connecting wallet..');
      dom.show(this.loader);
      dom.hide(this.form);
      this.postMessageToParentWindow('connect-wallet');
    } else if (this.approve) {
      debug('approving..');
      this.setIsWorking('Approving..');
      this.postMessageToParentWindow('approve', {
        fromAssetAddress: this.fromAsset.address,
        fromAssetDecimals: this.fromAsset.decimals,
        amount: this.fromAssetAmount,
      });
    } else {
      debug('swaping..');
      this.setIsWorking('Swaping..');
      this.postMessageToParentWindow('swap', {
        toEthereum: this.props.toEthereum,
        fromAssetAddress: this.fromAsset.address,
        fromAssetDecimals: this.fromAsset.decimals,
        toAssetAddress: this.toAsset.address,
        toAssetDecimals: this.toAsset.decimals,
        amount: this.fromAssetAmount,
        address: this.address,
      });
    }
  }

  onConnected({ address }) {
    dom.hide(this.loader);
    dom.show(this.form);

    this.address = address;
    debug('connected', address);
    dom.show(this.addressLabel, 1);
    this.addressLabel.querySelector('span').innerText = `${address.slice(
      0,
      6
    )}....${address.slice(-4)}`;
    this.updateQuote();
  }

  setIsWorking(text) {
    const working = !!text;
    dom.attr(this.fromAssetAmountInput, 'disabled', working);
    dom.attr(this.fromAssetSelect, 'disabled', working);
    dom.attr(this.button, 'disabled', working);
    if (working) {
      this.setButtonText(text);
    }
  }

  onError(err) {
    debug('received error: %s', err.message); // todo display error to user
    this.setIsWorking(false);
    this.updateQuote();
  }

  handleMessages() {
    if (window.addEventListener) {
      window.addEventListener('message', this.handleMessage, false);
    } else {
      window.attachEvent('onmessage', this.handleMessage);
    }
  }

  async handleMessageBound(evt) {
    let msg;
    try {
      msg = JSON.parse(evt.data);
    } catch {
      return;
    }
    debug('msg: %s', msg.sid);
    if (parseInt(msg.sid) !== parseInt(this.props.sid)) {
      return debug('ignoring msg(%s) self(%s)', msg.sid, this.props.sid);
    }
    debug('msg %o', msg);
    switch (msg.type) {
      case 'set-from-assets': {
        this.onLoadFromAssets(msg.payload);
        break;
      }

      case 'set-quote': {
        this.onUpdateQuote(msg.payload);
        break;
      }

      case 'connected': {
        this.onConnected(msg.payload);
        break;
      }

      case 'approved': {
        this.onApproved(msg.payload);
        break;
      }

      case 'swaped': {
        this.onSwapped(msg.payload);
        break;
      }

      case 'error': {
        this.onError(msg.payload);
        break;
      }

      default:
        debug('unknown msg type', msg.type);
    }
  }

  postMessageToParentWindow(type, payload = {}) {
    window.top.postMessage(
      JSON.stringify({ type, payload, sid: this.props.sid }),
      this.props.host
    );
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
