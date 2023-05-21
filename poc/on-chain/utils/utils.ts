import {ethers} from "hardhat";

export async function getSigners() {
    const [_, deployer, admin, manager, shop, customer, third] = await ethers.getSigners();
    return {_, deployer, admin, manager, shop, customer, third};
}
