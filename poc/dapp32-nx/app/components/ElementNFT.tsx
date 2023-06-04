import React, {useEffect, useState} from 'react';
import {ethers} from 'ethers';

import {ComponentProps} from "./types";
import Web3ProviderContext from "./Web3ProviderContext";


interface NFTComponentProps extends ComponentProps {
    params: {
        chainId: number | string;
        contractAddress: string;
        tokenId: string;
    };
}

interface Attribute {
    trait_type: string;
    value: string;
}

interface Metadata {
    description?: string;
    external_url?: string;
    image?: string;
    name?: string;
    attributes?: Attribute[];
}

const functionAbi721 = [
    {
        "constant": true,
        "inputs": [
            {
                "name": "tokenId",
                "type": "uint256"
            }
        ],
        "name": "tokenURI",
        "outputs": [
            {
                "name": "",
                "type": "string"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    }
];

const functionAbi1155 = [
    {
        "constant": true,
        "inputs": [
            {
                "name": "tokenId",
                "type": "uint256"
            }
        ],
        "name": "uri",
        "outputs": [
            {
                "name": "",
                "type": "string"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    }
];

const IMG_ERROR_PREFIX = "Image not found: ";

export const ElementNFT: React.FC<NFTComponentProps> = ({label, value, params}) => {
    const [metadata, setMetadata] = useState<Metadata>({});

    const web3provider = React.useContext(Web3ProviderContext);

    useEffect(() => {
        const fetchMetadata = async () => {
            try {

                // TODO: check chain id

                let tokenURI: string;
                {
                    const provider = web3provider || (new ethers.BrowserProvider(window.ethereum as any));

                    try {
                        const contract = new ethers.Contract(params.contractAddress, functionAbi721, provider);
                        tokenURI = await contract.tokenURI(params.tokenId);
                    } catch (error) {
                        const contract = new ethers.Contract(params.contractAddress, functionAbi1155, provider);
                        tokenURI = await contract.uri(params.tokenId);
                    }
                }

                if (tokenURI.startsWith('data:application/json;base64,')) {
                    setMetadata(JSON.parse(atob(tokenURI.split(',')[1])));
                } else {
                    await fetch(tokenURI).then(
                        response => response.json()
                    ).then(
                        setMetadata
                    );
                }
            } catch (error) {
                console.error("Failed to fetch NFT metadata:", error);
            }
        };

        fetchMetadata();
    }, [params]);

    return (
        <label>
            {label}
            <div className={"nft-container"}>
                <div className={"nft-name"}>
                    {metadata.name}
                </div>
                <div className={"nft-description"}>
                    {metadata.description}
                </div>
                <div className={"image-container"}>
                    <div className={"image-aspect-helper"}>
                        {
                            ((typeof metadata.image === 'string') && metadata.image.startsWith(IMG_ERROR_PREFIX)) ?
                                <span>{metadata.image}</span> :
                                <img
                                    className={"image"}
                                    src={metadata.image} alt={metadata.name || 'NFT image'}
                                    onError={() => setMetadata({
                                        ...metadata,
                                        image: `${IMG_ERROR_PREFIX}"${metadata.image}"`
                                    })}
                                />
                        }
                    </div>
                    <div className={"image-url"}>
                        {metadata.external_url && <a href={metadata.external_url}>External URL</a>}
                    </div>
                </div>
                <div className={"nft-attributes"}>
                    {metadata.attributes?.map((attribute, index) => (
                        <div key={index}>
                            <b>{attribute.trait_type}: </b>
                            <span>{attribute.value}</span>
                        </div>
                    ))}
                </div>
            </div>
        </label>
    );
};
