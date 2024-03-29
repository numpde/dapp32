import React, {useState, useEffect} from 'react';
import {isSameAddress} from "@opengsn/common";
import {CopyToClipboard} from "react-copy-to-clipboard";

import {ComponentProps} from "./types";
import {NFT} from "./elements/NFT";
import {QR} from "./elements/QR";


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
                className={(!value && readOnly) ? "empty" : undefined}
                id={id}
                placeholder={placeholder}
                value={(!value && readOnly) ? "[empty]" : value}
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
    const [mouseDown, setMouseDown] = useState<boolean>(false);

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

    const displayValue = (readOnly && !mouseDown) ? (value.slice(0, 6) + ".".repeat(32) + value.slice(-4)) : value;

    return (
        <label>
            {label}
            <div className="address-input-container">
                <input
                    className={`address ${valid ? "" : "invalid"}`}
                    id={id}
                    placeholder={placeholder}
                    value={displayValue}
                    onInput={e => setValue(e.currentTarget.value)}
                    readOnly={readOnly}
                    onMouseDown={() => setMouseDown(true)}
                    onMouseUp={() => setMouseDown(false)}
                />
                {readOnly && (
                    <CopyToClipboard text={value}>
                        <button className="copy-button">Copy</button>
                    </CopyToClipboard>
                )}
            </div>

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
};


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
    nft: NFT,
};
