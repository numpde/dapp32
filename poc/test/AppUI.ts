import {ethers} from "hardhat";
import {getSigners} from "../utils/utils";
import {expect} from "chai";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";


async function deployAppUI() {
    const {deployer} = await getSigners();

    const AppUI = await ethers.getContractFactory("AppUI");

    const appUI = await AppUI.connect(deployer).deploy();

    return {appUI};
}

describe("AppUI", function () {
    describe("Deployment", function () {

    });

    describe("Views", function () {
        it("Should return the initial view", async function () {
            const {appUI} = await loadFixture(deployAppUI);
            const {deployer} = await getSigners();

            const viewURI = await appUI.connect(deployer).getInitialView();

            await expect(viewURI).to.match(/^http/);
            console.log(viewURI);
        });

    });
});
