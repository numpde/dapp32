import {ethers} from "hardhat";
import {deployed} from "../hardhat.config";
import {StaticJsonRpcProvider as StaticJsonRpcProviderV5} from '@ethersproject/providers';
import {JsonRpcProvider as JsonRpcProviderV6, Wallet as WalletV6} from 'ethers-v6';
import {Contract as ContractV5, Wallet as WalletV5} from 'ethers';

const {RelayProvider} = require('@opengsn/provider')
import {Web3Provider} from '@ethersproject/providers';
import Web3 from "web3";

const main = async () => {
    const [deployer] = await ethers.getSigners();

    const GANACHE_PK = "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d";

    const chainId = (await ethers.provider.getNetwork()).chainId;

    if (chainId !== 1337) {
        throw new Error("This deployment script should only be used on ganache!");
    }

    const contractAddress = deployed.ganache.CaptureThatFlag;
    const contractABI = require('../artifacts/contracts/CaptureThatFlag.sol/CaptureThatFlag.json').abi;

    const path = "../../opengsn-local/build/gsn/";
    const paymasterAddress = require(path + 'Paymaster.json').address;
    const forwarderAddress = require(path + 'Forwarder.json').address;

    const contract0 = new ethers.Contract(contractAddress, contractABI, deployer);
    const tx = await contract0.setTrustedForwarder(forwarderAddress);
    await tx.wait();

    const config = {
        paymasterAddress,
        performDryRunViewRelayCall: true,
        loggerConfiguration: {logLevel: 'error'},
    };

    const rpcURL = 'http://localhost:8546';  // !
    // const ethersV5Provider = new StaticJsonRpcProviderV5(rpcURL);
    //
    // const {gsnProvider, gsnSigner} = await RelayProvider.newEthersV5Provider({
    //     provider: ethersV5Provider,
    //     config: config,
    // })

    const ethersV5Provider = new StaticJsonRpcProviderV5(rpcURL);
    const walletV5 = new WalletV5(GANACHE_PK, ethersV5Provider);
    const {gsnProvider, gsnSigner} = await RelayProvider.newEthersV5Provider({provider: walletV5, config});


    // const baseProvider = new Web3('http://localhost:8545');
    // const { gsnSigner } = await RelayProvider.newEthersV5Provider({provider: baseProvider.currentProvider, config});

    const contract = new ethers.Contract(contractAddress, contractABI, gsnSigner);

    console.info("CAPTURED BY (0):", await contract.capturedBy());

    const result = await contract.reset();
    await result.wait();

    console.info("CAPTURED BY (1):", await contract.capturedBy());

    // get balance of gsnSigner
    const balanceBeforeCapture = await gsnSigner.getBalance();

    const tx2 = await contract.captureTheFlag();
    await tx2.wait();

    const balanceAfterCapture = await gsnSigner.getBalance();

    console.info("CAPTURED BY (2):", await contract.capturedBy());
    console.info("Balance before capture:", balanceBeforeCapture);
    console.info("Balance after capture: ", balanceAfterCapture);

    let newWallet = new WalletV5(WalletV5.createRandom().privateKey, gsnProvider);
    const {gsnSigner: newGsnSigner} = await RelayProvider.newEthersV5Provider({provider: newWallet, config});

    // const to = await newWallet.getAddress();
    // const value = ethers.utils.parseEther("1.0");
    // console.info("To: ", to, "Value: ", value);
    // const web3 = new Web3(rpcURL);
    // const tx_send = await web3.eth.sendTransaction({from: await walletV5.getAddress(), to: await newWallet.getAddress(), value: value as any});
    // console.info("TX: ", tx_send);
    // console.info("Balance after send: ", await gsnSigner.getBalance());

    console.info("Balance of new wallet before capture: ", await newWallet.getBalance());

    const tx3 = await contract.connect(newGsnSigner).captureTheFlag();
    await tx3.wait();

    console.info("Balance of new wallet after capture: ", await newWallet.getBalance());

    console.info("CAPTURED BY (3):", await contract.capturedBy());
};

// const x = () => {
//     // const baseProvider = ethers.provider;
//     const baseProvider = new Web3('http://localhost:8545');
//
//     const relayProvider = await RelayProvider.newProvider({
//         provider: baseProvider.currentProvider,
//         config: {
//             paymasterAddress,
//             gasPriceSlackPercent: 1000,
//
//             // loggerConfiguration: {
//             //     logLevel: 'debug'
//             // },
//         },
//     }).init()
//
//     const web3 = new Web3(relayProvider);
//     const signers = await web3.eth.getAccounts();
//     const contract = new web3.eth.Contract(contractABI, contractAddress);
//
//     const result = await contract.methods.reset().send({from: signers[0]})
//     console.log("tx1:", result);
//
//     console.log("Captured by:", await contract.methods.capturedBy().call());
//
//     // const flag1 = await contract.capturedBy();
//     // console.log("Captured by:", await flag1);
//     //
//     // const tx2 = await contract.captureTheFlag();
//     // await tx2.wait();
//     //
//     // const flag2 = await contract.capturedBy();
//     // console.log("Captured by:", await flag2);
//     //
//     // const from = await ethersProvider.getSigner(1);
//     //
//     // const tx3 = await contract.connect(from).captureTheFlag();
//     // await tx3.wait();
//     //
//     // const flag3 = await contract.capturedBy();
//     // console.log("Captured by:", await flag3);
// };

main().catch(console.error);
