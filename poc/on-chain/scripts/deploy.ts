import {ethers} from "hardhat";

async function main() {
    const Factory = await ethers.getContractFactory("AppUI");
    const appUI = await Factory.deploy();

    await appUI.deployed();

    console.log(
        "AppUI deployed to:",
        appUI.address,
    );
}

main().catch(console.error);
