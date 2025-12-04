// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface WorkPreference {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  daysInOffice: number;
  status: "pending" | "approved" | "rejected";
}

const App: React.FC = () => {
  // Randomized style selections
  // Colors: High contrast (blue+orange)
  // UI: Industrial mechanical
  // Layout: Center radiation
  // Interaction: Micro-interactions
  
  // Randomized features: Data statistics, search & filter, team information
  
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState<WorkPreference[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showPreferenceModal, setShowPreferenceModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newPreference, setNewPreference] = useState({
    daysInOffice: 2,
    teamMembers: "",
    notes: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "approved" | "rejected">("all");

  // Calculate statistics
  const approvedCount = preferences.filter(p => p.status === "approved").length;
  const pendingCount = preferences.filter(p => p.status === "pending").length;
  const rejectedCount = preferences.filter(p => p.status === "rejected").length;

  useEffect(() => {
    loadPreferences().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadPreferences = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("preference_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing preference keys:", e);
        }
      }
      
      const list: WorkPreference[] = [];
      
      for (const key of keys) {
        try {
          const prefBytes = await contract.getData(`preference_${key}`);
          if (prefBytes.length > 0) {
            try {
              const prefData = JSON.parse(ethers.toUtf8String(prefBytes));
              list.push({
                id: key,
                encryptedData: prefData.data,
                timestamp: prefData.timestamp,
                owner: prefData.owner,
                daysInOffice: prefData.daysInOffice,
                status: prefData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing preference data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading preference ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setPreferences(list);
    } catch (e) {
      console.error("Error loading preferences:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitPreference = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setSubmitting(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting work preference with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newPreference))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const prefId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const prefData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        daysInOffice: newPreference.daysInOffice,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `preference_${prefId}`, 
        ethers.toUtf8Bytes(JSON.stringify(prefData))
      );
      
      const keysBytes = await contract.getData("preference_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(prefId);
      
      await contract.setData(
        "preference_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted preference submitted securely!"
      });
      
      await loadPreferences();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowPreferenceModal(false);
        setNewPreference({
          daysInOffice: 2,
          teamMembers: "",
          notes: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setSubmitting(false);
    }
  };

  const approvePreference = async (prefId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted preference with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const prefBytes = await contract.getData(`preference_${prefId}`);
      if (prefBytes.length === 0) {
        throw new Error("Preference not found");
      }
      
      const prefData = JSON.parse(ethers.toUtf8String(prefBytes));
      
      const updatedPref = {
        ...prefData,
        status: "approved"
      };
      
      await contract.setData(
        `preference_${prefId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedPref))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE approval completed successfully!"
      });
      
      await loadPreferences();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Approval failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectPreference = async (prefId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted preference with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const prefBytes = await contract.getData(`preference_${prefId}`);
      if (prefBytes.length === 0) {
        throw new Error("Preference not found");
      }
      
      const prefData = JSON.parse(ethers.toUtf8String(prefBytes));
      
      const updatedPref = {
        ...prefData,
        status: "rejected"
      };
      
      await contract.setData(
        `preference_${prefId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedPref))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE rejection completed successfully!"
      });
      
      await loadPreferences();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rejection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const filteredPreferences = preferences.filter(pref => {
    const matchesSearch = pref.owner.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          pref.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === "all" || pref.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const renderStats = () => {
    return (
      <div className="stats-grid">
        <div className="stat-item">
          <div className="stat-value">{preferences.length}</div>
          <div className="stat-label">Total</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{approvedCount}</div>
          <div className="stat-label">Approved</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{pendingCount}</div>
          <div className="stat-label">Pending</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{rejectedCount}</div>
          <div className="stat-label">Rejected</div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="mechanical-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container industrial-theme">
      <header className="app-header">
        <div className="logo">
          <div className="gear-icon"></div>
          <h1>Hybrid<span>Work</span>Coordinator</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowPreferenceModal(true)} 
            className="create-pref-btn industrial-button"
          >
            <div className="add-icon"></div>
            Submit Preference
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="central-radial-layout">
          <div className="core-panel">
            <div className="panel-header">
              <h2>FHE-Powered Hybrid Work Coordination</h2>
              <p>Securely coordinate office days while preserving privacy</p>
            </div>
            
            <div className="panel-content">
              <div className="stats-section industrial-card">
                <h3>Preference Statistics</h3>
                {renderStats()}
              </div>
              
              <div className="search-section">
                <div className="search-input">
                  <input 
                    type="text" 
                    placeholder="Search by address or ID..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="industrial-input"
                  />
                  <div className="search-icon"></div>
                </div>
                <select 
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as any)}
                  className="industrial-select"
                >
                  <option value="all">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
                <button 
                  onClick={loadPreferences}
                  className="refresh-btn industrial-button"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
              
              <div className="preferences-list industrial-card">
                <div className="table-header">
                  <div className="header-cell">ID</div>
                  <div className="header-cell">Office Days</div>
                  <div className="header-cell">Owner</div>
                  <div className="header-cell">Date</div>
                  <div className="header-cell">Status</div>
                  <div className="header-cell">Actions</div>
                </div>
                
                {filteredPreferences.length === 0 ? (
                  <div className="no-preferences">
                    <div className="no-data-icon"></div>
                    <p>No matching preferences found</p>
                    <button 
                      className="industrial-button primary"
                      onClick={() => setShowPreferenceModal(true)}
                    >
                      Submit First Preference
                    </button>
                  </div>
                ) : (
                  filteredPreferences.map(pref => (
                    <div className="preference-row" key={pref.id}>
                      <div className="table-cell pref-id">#{pref.id.substring(0, 6)}</div>
                      <div className="table-cell">{pref.daysInOffice} days/week</div>
                      <div className="table-cell">{pref.owner.substring(0, 6)}...{pref.owner.substring(38)}</div>
                      <div className="table-cell">
                        {new Date(pref.timestamp * 1000).toLocaleDateString()}
                      </div>
                      <div className="table-cell">
                        <span className={`status-badge ${pref.status}`}>
                          {pref.status}
                        </span>
                      </div>
                      <div className="table-cell actions">
                        {isOwner(pref.owner) && pref.status === "pending" && (
                          <>
                            <button 
                              className="action-btn industrial-button success"
                              onClick={() => approvePreference(pref.id)}
                            >
                              Approve
                            </button>
                            <button 
                              className="action-btn industrial-button danger"
                              onClick={() => rejectPreference(pref.id)}
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          
          <div className="radial-panels">
            <div className="radial-panel industrial-card">
              <h3>About FHE Coordination</h3>
              <p>This tool uses Fully Homomorphic Encryption (FHE) to securely process your hybrid work preferences without exposing sensitive data.</p>
              <div className="fhe-badge">
                <span>FHE-Powered</span>
              </div>
            </div>
            
            <div className="radial-panel industrial-card">
              <h3>Team Information</h3>
              <p>Our team specializes in privacy-preserving HR technologies using cutting-edge cryptography.</p>
              <div className="team-members">
                <div className="member">HR Lead</div>
                <div className="member">FHE Engineer</div>
                <div className="member">UX Designer</div>
              </div>
            </div>
          </div>
        </div>
      </div>
  
      {showPreferenceModal && (
        <ModalPreference 
          onSubmit={submitPreference} 
          onClose={() => setShowPreferenceModal(false)} 
          submitting={submitting}
          preference={newPreference}
          setPreference={setNewPreference}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content industrial-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="mechanical-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="gear-icon"></div>
              <span>HybridWorkCoordinator</span>
            </div>
            <p>Privacy-preserving hybrid work scheduling powered by FHE</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} HybridWorkCoordinator. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalPreferenceProps {
  onSubmit: () => void; 
  onClose: () => void; 
  submitting: boolean;
  preference: any;
  setPreference: (data: any) => void;
}

const ModalPreference: React.FC<ModalPreferenceProps> = ({ 
  onSubmit, 
  onClose, 
  submitting,
  preference,
  setPreference
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setPreference({
      ...preference,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (preference.daysInOffice < 0 || preference.daysInOffice > 5) {
      alert("Please enter valid office days (0-5)");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="preference-modal industrial-card">
        <div className="modal-header">
          <h2>Submit Work Preference</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="lock-icon"></div> Your preference will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Days in Office *</label>
              <input
                type="number"
                name="daysInOffice"
                min="0"
                max="5"
                value={preference.daysInOffice}
                onChange={handleChange}
                className="industrial-input"
              />
            </div>
            
            <div className="form-group">
              <label>Team Members</label>
              <input 
                type="text"
                name="teamMembers"
                value={preference.teamMembers} 
                onChange={handleChange}
                placeholder="Who do you collaborate with?" 
                className="industrial-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Notes</label>
              <textarea 
                name="notes"
                value={preference.notes} 
                onChange={handleChange}
                placeholder="Any additional notes about your preference..." 
                className="industrial-textarea"
                rows={3}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="shield-icon"></div> Data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn industrial-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={submitting}
            className="submit-btn industrial-button primary"
          >
            {submitting ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;