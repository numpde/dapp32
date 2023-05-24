import {ethers} from "hardhat";


async function deployContract() {
    const [owner, other] = await ethers.getSigners();

    const Contract = await ethers.getContractFactory("CaptureThatFlag");
    const contract = await Contract.deploy();

    await contract.deployed();

    // console.log("CaptureThatFlag deployed to:", contract.address);

    // const tx = await contract.setTrustedForwarder(forwarderAddress);
    // await tx.wait();

    return { contract, owner, other };
}
