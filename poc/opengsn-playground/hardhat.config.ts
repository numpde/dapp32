import {HardhatUserConfig} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
    solidity: "0.8.18",

    networks: {
        ganache: {
            url: "http://127.0.0.1:8545",
        },
    }
};

const deployed = {
    ganache: {
        CaptureThatFlag: "0xB68eF8E67791196089911031bf9efB7ee0487106",
    },
}

export default config;
export {deployed};
