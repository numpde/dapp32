import React, {useState, useEffect} from 'react';
import {QRCodeCanvas} from 'qrcode.react';
import {isSameAddress} from "@opengsn/common";

import {ComponentProps, VariablesOfUI} from "./types";
import {ElementNFT} from "./ElementNFT";


const InputField: React.FC<ComponentProps> = (
    {
        id,
        label,
        placeholder,
        value: initialValue,
        onVariablesUpdate,
        readOnly
    }
) => {
    const [value, setValue] = useState<string>(initialValue || '');

    useEffect(() => onVariablesUpdate?.({[id]: value}), [value, id, onVariablesUpdate]);

    return (
        <label>
            {label}
            <input
                id={id}
                placeholder={placeholder}
                value={value}
                onInput={e => setValue(e.currentTarget.value)}
                readOnly={readOnly}
            />
        </label>
    );
};

const AddressField: React.FC<ComponentProps> = (
    {
        id,
        label,
        placeholder,
        value: initialValue,
        onVariablesUpdate,
        readOnly,
        variables
    }
) => {
    const ethAddressPattern = /^0x[a-fA-F0-9]{40}$/;

    const [valid, setValid] = useState<boolean>(true);
    const [value, setValue] = useState<string>(initialValue || '');

    useEffect(() => onVariablesUpdate?.({[id]: value}), [value, id, onVariablesUpdate]);

    useEffect(() => {
        onVariablesUpdate?.({[id]: value});
        setValid(ethAddressPattern.test(value));
    }, [value, id, onVariablesUpdate]);

    const setAddress = (address: string) => {
        if (ethAddressPattern.test(address)) {
            setValue(address);
        }
    };

    return (
        <label>
            {label}
            <input
                className={`address ${valid ? "" : "invalid"}`}
                id={id}
                placeholder={placeholder}
                value={value}
                onInput={e => setValue(e.currentTarget.value)}
                readOnly={readOnly}
            />

            {
                !readOnly &&
                <div className={"addresses"}>
                    <span>Suggestions:</span>
                    {Object.entries(variables).map(([k, v]) =>
                            ethAddressPattern.test(v) && (
                                isSameAddress(v, value) ?
                                    <span key={k}>{k}</span> :
                                    <a key={k} onClick={() => setAddress(variables[k])} style={{cursor: 'pointer'}}>{k}</a>
                            )
                    )}
                </div>
            }

        </label>
    );
}


const SelectDropdown: React.FC<ComponentProps> = ({id, label, options, value: initialValue, onVariablesUpdate}) => {
    const [value, setValue] = useState<string>(initialValue || '');

    useEffect(() => onVariablesUpdate?.({[id]: value}), [value, id, onVariablesUpdate]);

    return (
        <label>
            {label}
            <select id={id} value={value} onChange={(e) => setValue(e.target.value)}>
                {
                    options && !options.includes(value) &&
                    <option value={value} key={value}>{value}</option>
                }
                {
                    options?.map((option, i) => <option value={option} key={i}>{option}</option>)
                }
            </select>
        </label>
    )
};

const Button: React.FC<ComponentProps> = ({id, label, onClick}) => (
    <button id={id} onClick={onClick}>{label}</button>
);

const Text: React.FC<ComponentProps> = ({id, label}) => (
    <div id={id}><span>{label}</span></div>
);

const QR: React.FC<ComponentProps> = ({id, label, value, params}) => {
    const constructURL = (!value && params);

    if (value && params) {
        console.warn(`QR component has both 'value' and 'params'. Value will be used.`);
    }

    if (constructURL) {
        const {basePath, ...urlParams} = params;
        const url = new URL(basePath);
        Object.entries(urlParams).forEach(([k, v]) => url.searchParams.append(k, `${v}`));
        value = url.toString();
    }

    return (
        <div id={id}>
            <div>
                <span>{label}</span>
            </div>
            <div className="image-container">
                <div className="image-aspect-helper">
                    {
                        value ?
                            // Levels: L (7%), M (15%), Q (25%), H (30%)
                            <QRCodeCanvas level="M" value={value} className="qrcode" size={256}/> :
                            <span>(no data)</span>
                    }
                </div>
                <div className="image-url">
                    {
                        constructURL &&
                        <a href={value} target="_blank" rel="noreferrer">link</a>
                    }
                </div>
            </div>
        </div>
    )
};


export const COMPONENT_MAP: {
    [key: string]: React.ComponentType<any>,
} = {
    input: InputField,
    address: AddressField,
    select: SelectDropdown,
    button: Button,
    text: Text,
    qr: QR,
    qrcode: QR,
    nft: ElementNFT,
};
