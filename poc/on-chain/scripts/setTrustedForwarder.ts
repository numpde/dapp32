import {ethers} from "hardhat";
import {deployed} from "../deployed";

async function main() {
    const chainId = (await ethers.provider.getNetwork()).chainId;

    if (chainId !== 1337) {
        throw new Error("This script should only be used on ganache!");
    }

    const appUI = await ethers.getContractAt("AppUI", deployed.ganache.AppUI);

    const trustedForwarder = "0xB38A4f0B0610c890e8C4d99160dDFaEfD4D742d4";

    const tx = await appUI.setTrustedForwarder(trustedForwarder);
    await tx.wait();
}

main().catch(console.error);
