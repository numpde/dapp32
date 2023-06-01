import React, {ReactNode} from 'react';
import './styles.css';

const AppContainer: React.FC<{ children: ReactNode }> = ({children}) => {
    return (
        <div className="app-container">
            <header className="app-header">
                <h1>dapp32</h1>
            </header>

            {children}


            <div className="spacer"></div>

            <footer className="app-footer">
                <p>© 2023 Dapp32. All rights reserved.</p>
            </footer>
        </div>
    );
}

export default AppContainer;
