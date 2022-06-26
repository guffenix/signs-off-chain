const { expect } = require('chai')
const { ethers } = require('hardhat')

const eip712DomainTypeDefinition = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
]

const signatureTypeDefinition = [
  { name: 'signer', type: 'address' },
  { name: 'message', type: 'string' },
]

/* typedDataInput
  {
    domainValues: {
      name: <string>,
      version: <string>,
      chainId: <number>,
      verifyingContract: <string>
    },
    primaryType: "Signature",
    messageValues: {
      signer: <string>,
      message: <string>,
    }
  }
*/

// Getting typed Data
function getTypedData(typedDataInput) {
  return {
    types: {
      EIP712Domain: eip712DomainTypeDefinition,
      [typedDataInput.primaryType]: signatureTypeDefinition,
    },
    primaryType: typedDataInput.primaryType,
    domain: typedDataInput.domainValues,
    message: typedDataInput.messageValues,
  }
}

describe('EIP712Counter test', function () {
  let counterContract
  let deployer
  let relayerAccount

  before(async function () {
    const availableSigners = await ethers.getSigners()
    deployer = availableSigners[0]
    // relayer account will pay for transactions fee
    relayerAccount = availableSigners[1]

    // Deploying contract
    const EIP712Counter = await ethers.getContractFactory(
      'EIP712MessageCounter',
    )
    counterContract = await EIP712Counter.deploy()
    await counterContract.deployed()
    counterContract.address
  })

  describe('Should allow a gas relayer send a transaction on behalf some other account', function () {
    // parameters
    let lastStoredMessageForAccount
    let relayerEthBeforeTx
    let deployerEthBeforeTx
    let messageCountForAccount
    let lastStoredMessageForRelayer
    let messageCountForRelayer
    let relayerEthAfterTx
    let deployerEthAfterTx

    let signatureMessage

    // Prepare structure of data to do the tests
    before(async function () {
      // using relayer as the account that sends the transaction
      const counterTmpInstance = await counterContract.connect(relayerAccount)
      // gettting the chain Id to be used in the domainSeparator
      const { chainId } = await relayerAccount.provider.getNetwork()

      // getting relayer and "user" ETH balance before transaction
      relayerEthBeforeTx = await relayerAccount.getBalance()
      deployerEthBeforeTx = await deployer.getBalance()

      signatureMessage = {
        signer: deployer.address,
        message: 'first message',
      }

      // Getting typed data
      const typedData = getTypedData({
        domainValues: {
          name: 'EIP712MessageCounter',
          version: '0.0.1',
          chainId: chainId,
          verifyingContract: counterTmpInstance.address,
        },
        primaryType: 'Signature',
        messageValues: signatureMessage,
      })

      // Using web3 provider to signed the structure with the "user's" key
      const signedMessage = await ethers.provider.send('eth_signTypedData_v4', [
        deployer.address,
        typedData,
      ])

      // sending transaction to network (relayer as the sender)
      await counterTmpInstance.setSignerMessage(signatureMessage, signedMessage)

      // getting that the last sent message was the one we just embeded in the transaction
      lastStoredMessageForAccount = await counterTmpInstance.lastMessageOf(
        deployer.address,
      )
      // Getting the message count for the user
      messageCountForAccount = await counterTmpInstance.countOf(
        deployer.address,
      )

      // Getting last sent message for the relayer
      lastStoredMessageForRelayer = await counterTmpInstance.lastMessageOf(
        relayerAccount.address,
      )
      // Getting the message count for the relayer
      messageCountForRelayer = await counterTmpInstance.countOf(
        relayerAccount.address,
      )

      // Getting the relayer and "user" ETH balance after the transaction
      relayerEthAfterTx = await relayerAccount.getBalance()
      deployerEthAfterTx = await deployer.getBalance()
    })

    it('Should be sure the last message for the user is equal to embedded message in the transaction', async function () {
      // Making sure the last message for the user is equal to embedded message in the transaction
      expect(lastStoredMessageForAccount).to.equal(signatureMessage.message)
    })

    it('Should be sure the message count for the "user" is equal to one', async function () {
      // Making sure the message count for the "user" is equal to one
      expect(messageCountForAccount.eq(ethers.BigNumber.from(1))).to.be.true
    })

    it('Should be sure the last message for the relayer es empty despite being the account that sent the transaction to the network', async function () {
      // Making sure the last message for the relayer es empty despite being the account that sent the transaction to the network
      expect(lastStoredMessageForRelayer).to.be.equal('')
    })

    it('Should be sure the message count for the relayer is zero', async function () {
      // Making sure the message count for the relayer is zero
      expect(messageCountForRelayer.eq(ethers.BigNumber.from(0))).to.be.true
    })

    it('Should be sure the relayer balance has decreased because it paid for the Tx fee', async function () {
      // Making sure the relayer balance has decreased because it paid for the Tx fee
      expect(relayerEthAfterTx.lt(relayerEthBeforeTx)).to.be.true
    })

    it('Should be sure the deployer balance did not change', async function () {
      // Making sure the deployer balance did not change
      expect(deployerEthBeforeTx.eq(deployerEthAfterTx)).to.be.true
    })
  })
})
