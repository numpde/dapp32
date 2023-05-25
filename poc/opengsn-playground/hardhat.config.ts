import {HardhatUserConfig} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
    solidity: "0.8.18",

    networks: {
        ganache: {
            url: "http://127.0.0.1:8546",
        },
    }
};

const deployed = {
    ganache: {
        CaptureThatFlag: "0x06143d6bec9Fa1e90f18920d01f9085793F1729F",
    },
}

export default config;
export {deployed};
