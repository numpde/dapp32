import React, {useState, useEffect} from 'react';

type ComponentProps = {
    id: string,
    label: string,
    onClick?: () => void,
    placeholder?: string,
    value?: string,
    options?: string[],
    onVariablesUpdate?: (value: Record<string, unknown>) => void
}

const InputField: React.FC<ComponentProps> = ({id, label, placeholder, value: initialValue, onVariablesUpdate}) => {
    const [value, setValue] = useState<string>(initialValue || '');

    useEffect(() => onVariablesUpdate?.({[id]: value}), [value, id, onVariablesUpdate]);

    return (
        <label>
            {label}
            <input id={id} placeholder={placeholder} value={value} onInput={e => setValue(e.currentTarget.value)}/>
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


export const COMPONENT_MAP: {
    [key: string]: React.ComponentType<any>,
} = {
    input: InputField,
    select: SelectDropdown,
    button: Button,
};
