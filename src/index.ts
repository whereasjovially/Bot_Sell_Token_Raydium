import { Wallet } from '@project-serum/anchor';
import RaydiumSwap from './RaydiumSwap'
import { Transaction, VersionedTransaction, LAMPORTS_PER_SOL, Connection, PublicKey, Keypair  } from '@solana/web3.js'
import base58 from 'bs58'
import 'dotenv/config'
import { JitoTransactionExecutor } from './jito-rpc-transaction-executor';
const connection = new Connection(
  process.env.RPC_URL
);
const wallet = new Wallet(Keypair.fromSecretKey(base58.decode(process.env.WALLET_PRIVATE_KEY))) 
const jito = new JitoTransactionExecutor(connection)

const prepareForRaydium = async ({baseMint, quoteMint}) => {
  console.log('Preparing...')
  const raydiumSwap = new RaydiumSwap(process.env.RPC_URL, process.env.WALLET_PRIVATE_KEY)
  // console.log(`Raydium swap initialized`)

  // Loading with pool keys from https://api.raydium.io/v2/sdk/liquidity/mainnet.json
  await raydiumSwap.loadPoolKeys()
  // console.log(`Loaded pool keys`)

  // Trying to find pool info in the json we loaded earlier and by comparing baseMint and tokenBAddress
  let poolInfo = raydiumSwap.findPoolInfoForTokens(baseMint, quoteMint)

  if (!poolInfo) poolInfo = await raydiumSwap.findRaydiumPoolInfo(baseMint, quoteMint)

  if (!poolInfo) {
    throw new Error("Couldn't find the pool info")
  }

  // console.log('Found pool info', poolInfo)
  console.log('Finished preparing.')
  return {
    raydiumSwap, poolInfo
  }
}

const makeSellTransaction = async (tokenAAmount: number) => {
  const quoteMint = process.env.BAST_MINT
  const baseMint = process.env.QUOTE_MINT 
  const {raydiumSwap, poolInfo} = await prepareForRaydium({baseMint, quoteMint})
  const tx = await raydiumSwap.getSwapTransaction(
    quoteMint,
    tokenAAmount,
    poolInfo,
    Number(process.env.PRIORITIZAION_FEE) * LAMPORTS_PER_SOL, // Prioritization fee, now set to (0.0005 SOL)
    'in',
    5 // Slippage
  )
  return tx
}


const fetchTokenBalance = async (tokenAddress:string) => {
  try {
    const mintAddress = new PublicKey(tokenAddress);
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet.publicKey, { mint: mintAddress });
    const tokenAccountInfo = tokenAccounts.value.find(accountInfo => accountInfo.account.data.parsed.info.mint === mintAddress.toString());
    if (tokenAccountInfo) {
      const tokenAccountAddress = tokenAccountInfo.pubkey;
      const balance = await connection.getTokenAccountBalance(tokenAccountAddress);
      return balance.value.uiAmount || 0;
    }
    return 0;
  } catch (error) {
    console.error(`Error fetching ${tokenAddress} balance:`, error);
    return 0;
  }
};


const run  = async () => {
  const tokenAddress = process.env.QUOTE_MINT
  const jitoFee = process.env.JITO_FEE
  const txDelay = Number(process.env.TX_DELAY)
  const maxTxCnt = Number(process.env.MAX_TX_COUNT)
  const balance = await fetchTokenBalance(tokenAddress)
  const percentTokenToSell = Math.max(60, Number(process.env.PERCENT_TOKEN_TO_SELL))
  const amountToSell = balance * percentTokenToSell / 100
  console.log('current amount', balance)
  console.log('amountToSell', amountToSell)
  const sellTx = await makeSellTransaction(amountToSell)
  const latestBlockhash = await connection.getLatestBlockhash()
  jito.setIssuccess(false)

  let curPt = 0;
  while(1){
    jito.executeAndConfirm(sellTx, Keypair.fromSecretKey(base58.decode(process.env.WALLET_PRIVATE_KEY)), latestBlockhash, jitoFee);
    curPt++;
    console.log(`Sent ${curPt} Tx`)
    if(maxTxCnt <= curPt || jito.getIssuccess()){
      console.log(`Succeed Tx is https://solscan.io/tx/${jito.getSucceedTx()}`)
      break;
    }
    await delay(txDelay)
  }

}

run()

const delay = async ( milisecs: number) => {
  return new Promise(resolve=>setTimeout(resolve, milisecs));
}
