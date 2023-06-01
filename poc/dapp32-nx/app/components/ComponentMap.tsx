import React, {useState, useEffect} from 'react';
import {QRCodeCanvas} from 'qrcode.react';

type ComponentProps = {
    id: string,
    label?: string,
    onClick?: () => void,
    placeholder?: string,
    value?: string,
    options?: string[],
    onVariablesUpdate?: (value: Record<string, unknown>) => void,
    readOnly?: boolean,
    params?: any,
}

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
            <div className="qrcode-container">
                <div className="qrcode-aspect-helper">
                    {
                        value ?
                            // Levels: L (7%), M (15%), Q (25%), H (30%)
                            <QRCodeCanvas level="M" value={value} className="qrcode" size={256}/> :
                            <span>(no data)</span>
                    }
                </div>
                <div className="qrcode-url">
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
    select: SelectDropdown,
    button: Button,
    text: Text,
    qr: QR,
    qrcode: QR,
};
