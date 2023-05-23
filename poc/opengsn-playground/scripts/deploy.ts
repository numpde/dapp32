import {ethers} from "hardhat";

async function main() {
    const [deployer] = await ethers.getSigners();

    // check that we are on the ganache network using chainid
    const chainId = (await ethers.provider.getNetwork()).chainId;
    if (chainId !== 1337) {
        throw new Error("This deployment script should only be used on ganache!");
    }

    const path = "../../opengsn-local/build/gsn/";
    const forwarderAddress = require(path + "Forwarder.json").address;

    if (!forwarderAddress) {
        throw new Error(`Forwarder address not found in ${path}`);
    }

    const Contract = await ethers.getContractFactory("CaptureThatFlag");
    const contract = await Contract.deploy();

    await contract.deployed();

    console.log("CaptureThatFlag deployed to:", contract.address);

    const tx = await contract.setTrustedForwarder(forwarderAddress);
    await tx.wait();
}

main().catch(console.error);
