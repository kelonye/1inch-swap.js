import debug from './debug';

debug('boot');

let notification;
let button;
window.onload = onLoad;

function onLoad() {
  showExampleCode();

  notification = document.querySelector('.notification');
  button = document.querySelector('button');
  button.onclick = onStartSwap;
}

function onStartSwap(e) {
  e.preventDefault();
  e.stopPropagation();

  debug('swaping..');

  const close = window.oneInch({
    toTokenAddress: '0x6b175474e89094c44da98b954eedeac495271d0f',
    defaultAmount: 6,
    async onSwap(transactionHash) {
      close();

      debug('bought %s!', transactionHash);

      button.innerHTML = 'Bought <span style="font-family: none;">✓</span>';
      await notify('success', 'Done!', 'Waiting for transaction to be mined..');
      button.innerHTML = 'Swap';
    },
    onError(e) {
      close();
      debug('charge error %s', e.message);
      notify('error', 'An unexpected error occured.', e.message);
    },
    onCancel() {
      debug('user cancelled swap');
    },
  });
}

async function notify(type, title, message) {
  const [titleEl, messageEl] = notification.querySelectorAll('div');
  titleEl.innerText = title;
  messageEl.innerText = message;

  showNotification(type, true);
  await sleep(4000);
  showNotification(type, false);
}

function showNotification(type, show) {
  const types = ['success', 'error'];
  types.forEach(t => {
    notification.classList[t === type ? 'add' : 'remove'](t);
  });
  notification.classList[show ? 'remove' : 'add']('hidden');
  button.innerHTML = show
    ? 'Bought <span style="font-family: none;">✓</span>'
    : 'Swap';
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function showExampleCode() {
  const jsHost =
    process.env.NODE_ENV === 'production'
      ? 'https://1inch-swap.surge.sh/js/script.js'
      : 'http://localhost:3501/script.js';
  document.querySelector('code').innerText = `
<button id='buy-button'>Buy Token</button>

<script src='${jsHost}'></script>
<script>
  const button = document.getElementById('buy-button');
  button.onclick = function() {
    const closeModal = window.oneInch({
      toTokenAddress: '0x..', // or toEthereum: true,
      defaultAmount: 100,
      onSwap(transactionHash) {
        console.log('bought at %s!', transactionHash);
        closeModal();
      },
    });
  };
</script>`;
}
