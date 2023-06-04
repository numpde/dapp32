import React, {ReactNode} from 'react';
import {toast} from "react-hot-toast";

type ErrorBoundaryProps = {
    children: ReactNode;
};

type ErrorState = {
    hasError: boolean;
    error?: Error | null;
    errorInfo?: React.ErrorInfo | null;
};

export class ErrorBoundaryUI extends React.Component<ErrorBoundaryProps, ErrorState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = {hasError: false, error: null, errorInfo: null};
    }

    static getDerivedStateFromError(error: Error): ErrorState {
        // Update state so the next render will show the fallback UI.
        return {hasError: true, error};
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        // You can also log the error to an error reporting service
        console.error("Uncaught error:", error, errorInfo);
        this.setState({errorInfo});
    }

    render() {
        if (this.state.hasError) {
            toast.error(this.state.error?.message as any);
        } else {
            return this.props.children;
        }
    }
}
