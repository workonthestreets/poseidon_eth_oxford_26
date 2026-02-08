// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/**
 * @title MaritimeRiskOracle
 * @notice On-chain vessel data store for maritime risk data
 * @dev FDC Web2Json verification could not be made to work (DA layer validation failures
 *      on both proxy API and static GitHub JSON pages). This contract serves as a fallback:
 *      an authorized submitter pushes pre-fetched data (from offchain/data/risk_data/) directly
 *      on-chain so that VoyageAuction.sol can read it without any external oracle call.
 *
 *      Data flow:  Datalastic API → fetchVesselRiskProfile.ts → risk_data/*.json → 
 *                  deploy script reads JSON → submitVesselData() → on-chain storage
 *
 *      Voyage data comes from the Datalastic /vessel_pro endpoint which provides:
 *        - atd_epoch / atd_UTC  (Actual Time of Departure)
 *        - eta_epoch / eta_UTC  (Estimated Time of Arrival)
 *        - dep_port_unlocode    (Departure port UN/LOCODE)
 *        - destination          (Destination port)
 */
contract MaritimeRiskOracle {

    // ============ Data Structures ============

    enum NavigationStatus {
        Unknown,
        Moored,
        AtAnchor,
        UnderWay,
        Aground
    }

    /// @notice Core vessel record — one per IMO, updated by authorized submitter
    struct VesselData {
        string  imo;
        string  name;
        int256  latitude;          // Scaled by 1e6
        int256  longitude;         // Scaled by 1e6
        NavigationStatus navStatus;
        string  destination;
        uint256 lastUpdated;       // block.timestamp of last update
    }

    /// @notice Voyage-specific data from /vessel_pro endpoint
    struct VoyageData {
        string  departurePort;     // UN/LOCODE of departure port (e.g. "AEJEA")
        string  destinationPort;   // UN/LOCODE or name of destination
        uint256 atdEpoch;          // Actual Time of Departure (0 = not departed yet)
        uint256 etaEpoch;          // Estimated Time of Arrival
        uint256 ataEpoch;          // Actual Time of Arrival (0 = not arrived yet)
        uint256 lastUpdated;
    }

    /// @notice PSC inspection snapshot
    struct PSCRecord {
        bool    detained;
        uint256 deficiencyCount;
        string  inspectionPort;
        string  inspectionDate;
        string  inspectionAuthority;
    }

    /// @notice Casualty record
    struct CasualtyRecord {
        bool   detected;
        string casualtyType;       // e.g. "Collision", "Grounding", "Fire"
        string casualtyDate;
        string details;
    }

    /// @notice Dry dock record
    struct DryDockRecord {
        string nextDueDate;
        bool   isOverdue;
    }

    // ============ Storage ============

    address public owner;
    mapping(address => bool) public authorizedSubmitters;

    /// @notice IMO → vessel core data
    mapping(string => VesselData)     public vessels;
    /// @notice IMO → voyage data (ATD, ETA, ports)
    mapping(string => VoyageData)     public voyages;
    /// @notice IMO → latest PSC record
    mapping(string => PSCRecord)      public pscRecords;
    /// @notice IMO → latest casualty record
    mapping(string => CasualtyRecord) public casualtyRecords;
    /// @notice IMO → latest dry dock record
    mapping(string => DryDockRecord)  public dryDockRecords;

    /// @notice All known IMOs (for enumeration)
    string[] public knownIMOs;
    mapping(string => bool) public imoExists;

    // ============ Events ============

    event VesselDataUpdated(string indexed imo, string name, NavigationStatus navStatus);
    event VoyageDataUpdated(string indexed imo, uint256 atdEpoch, uint256 etaEpoch);
    event PSCRecordUpdated(string indexed imo, bool detained, uint256 deficiencyCount);
    event CasualtyRecordUpdated(string indexed imo, bool detected, string casualtyType);
    event DryDockRecordUpdated(string indexed imo, bool isOverdue);
    event NavigationStatusChanged(string indexed imo, NavigationStatus oldStatus, NavigationStatus newStatus);

    // ============ Modifiers ============

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyAuthorized() {
        require(authorizedSubmitters[msg.sender] || msg.sender == owner, "Not authorized");
        _;
    }

    // ============ Constructor ============

    constructor() {
        owner = msg.sender;
        authorizedSubmitters[msg.sender] = true;
    }

    // ============ Admin ============

    function setAuthorizedSubmitter(address submitter, bool authorized) external onlyOwner {
        authorizedSubmitters[submitter] = authorized;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    // ============ Data Submission ============

    /**
     * @notice Submit or update core vessel data (position, nav status, destination)
     */
    function submitVesselData(
        string calldata imo,
        string calldata name,
        int256 latitude,
        int256 longitude,
        NavigationStatus navStatus,
        string calldata destination
    ) external onlyAuthorized {
        NavigationStatus oldStatus = vessels[imo].navStatus;

        vessels[imo] = VesselData({
            imo: imo,
            name: name,
            latitude: latitude,
            longitude: longitude,
            navStatus: navStatus,
            destination: destination,
            lastUpdated: block.timestamp
        });

        if (!imoExists[imo]) {
            knownIMOs.push(imo);
            imoExists[imo] = true;
        }

        emit VesselDataUpdated(imo, name, navStatus);

        if (oldStatus != navStatus && vessels[imo].lastUpdated > 0) {
            emit NavigationStatusChanged(imo, oldStatus, navStatus);
        }
    }

    /**
     * @notice Submit voyage-specific data (departure/arrival times and ports)
     * @dev Data from Datalastic /vessel_pro endpoint:
     *      - atdEpoch = 0 means vessel has NOT departed yet (still at port of loading)
     *      - ataEpoch = 0 means vessel has NOT arrived yet
     *      This distinction is critical: a moored vessel at loading port can have a
     *      market created, but a moored vessel at discharge port is at settlement time.
     */
    function submitVoyageData(
        string calldata imo,
        string calldata departurePort,
        string calldata destinationPort,
        uint256 atdEpoch,
        uint256 etaEpoch,
        uint256 ataEpoch
    ) external onlyAuthorized {
        voyages[imo] = VoyageData({
            departurePort: departurePort,
            destinationPort: destinationPort,
            atdEpoch: atdEpoch,
            etaEpoch: etaEpoch,
            ataEpoch: ataEpoch,
            lastUpdated: block.timestamp
        });

        emit VoyageDataUpdated(imo, atdEpoch, etaEpoch);
    }

    /**
     * @notice Submit PSC inspection record
     */
    function submitPSCRecord(
        string calldata imo,
        bool detained,
        uint256 deficiencyCount,
        string calldata inspectionPort,
        string calldata inspectionDate,
        string calldata inspectionAuthority
    ) external onlyAuthorized {
        pscRecords[imo] = PSCRecord({
            detained: detained,
            deficiencyCount: deficiencyCount,
            inspectionPort: inspectionPort,
            inspectionDate: inspectionDate,
            inspectionAuthority: inspectionAuthority
        });

        emit PSCRecordUpdated(imo, detained, deficiencyCount);
    }

    /**
     * @notice Submit casualty record
     */
    function submitCasualtyRecord(
        string calldata imo,
        bool detected,
        string calldata casualtyType,
        string calldata casualtyDate,
        string calldata details
    ) external onlyAuthorized {
        casualtyRecords[imo] = CasualtyRecord({
            detected: detected,
            casualtyType: casualtyType,
            casualtyDate: casualtyDate,
            details: details
        });

        emit CasualtyRecordUpdated(imo, detected, casualtyType);
    }

    /**
     * @notice Submit dry dock record
     */
    function submitDryDockRecord(
        string calldata imo,
        string calldata nextDueDate,
        bool isOverdue
    ) external onlyAuthorized {
        dryDockRecords[imo] = DryDockRecord({
            nextDueDate: nextDueDate,
            isOverdue: isOverdue
        });

        emit DryDockRecordUpdated(imo, isOverdue);
    }

    /**
     * @notice Batch-submit all data for a vessel in one transaction
     * @dev Saves gas when loading from risk_data JSON files
     */
    function submitFullVesselProfile(
        string calldata imo,
        string calldata name,
        int256 latitude,
        int256 longitude,
        NavigationStatus navStatus,
        string calldata destination,
        // PSC
        bool pscDetained,
        uint256 pscDeficiencyCount,
        string calldata pscPort,
        string calldata pscDate,
        string calldata pscAuthority,
        // Casualty
        bool casualtyDetected,
        string calldata casualtyType,
        string calldata casualtyDate,
        string calldata casualtyDetails,
        // Dry dock
        string calldata dryDockNextDue,
        bool dryDockOverdue
    ) external onlyAuthorized {
        // Vessel core
        vessels[imo] = VesselData({
            imo: imo,
            name: name,
            latitude: latitude,
            longitude: longitude,
            navStatus: navStatus,
            destination: destination,
            lastUpdated: block.timestamp
        });

        if (!imoExists[imo]) {
            knownIMOs.push(imo);
            imoExists[imo] = true;
        }

        // PSC
        pscRecords[imo] = PSCRecord({
            detained: pscDetained,
            deficiencyCount: pscDeficiencyCount,
            inspectionPort: pscPort,
            inspectionDate: pscDate,
            inspectionAuthority: pscAuthority
        });

        // Casualty
        casualtyRecords[imo] = CasualtyRecord({
            detected: casualtyDetected,
            casualtyType: casualtyType,
            casualtyDate: casualtyDate,
            details: casualtyDetails
        });

        // Dry dock
        dryDockRecords[imo] = DryDockRecord({
            nextDueDate: dryDockNextDue,
            isOverdue: dryDockOverdue
        });

        emit VesselDataUpdated(imo, name, navStatus);
        emit PSCRecordUpdated(imo, pscDetained, pscDeficiencyCount);
        emit CasualtyRecordUpdated(imo, casualtyDetected, casualtyType);
        emit DryDockRecordUpdated(imo, dryDockOverdue);
    }

    // ============ Query Functions ============

    function getVessel(string memory imo) external view returns (VesselData memory) {
        return vessels[imo];
    }

    function getVoyage(string memory imo) external view returns (VoyageData memory) {
        return voyages[imo];
    }

    function getPSC(string memory imo) external view returns (PSCRecord memory) {
        return pscRecords[imo];
    }

    function getCasualty(string memory imo) external view returns (CasualtyRecord memory) {
        return casualtyRecords[imo];
    }

    function getDryDock(string memory imo) external view returns (DryDockRecord memory) {
        return dryDockRecords[imo];
    }

    function getKnownIMOCount() external view returns (uint256) {
        return knownIMOs.length;
    }

    // ============ Vessel State Queries ============

    /// @notice Check if vessel is currently moored (any port)
    function isVesselMoored(string memory imo) external view returns (bool) {
        return vessels[imo].navStatus == NavigationStatus.Moored;
    }

    /**
     * @notice Check if vessel is moored at port of loading (pre-departure)
     * @dev A vessel is at port of loading if:
     *      1. Navigation status is Moored
     *      2. ATD epoch is 0 (has not departed) OR ATD is in the future
     *      This distinguishes from a vessel moored at port of discharge (post-arrival).
     */
    function isVesselAtLoadingPort(string memory imo) external view returns (bool) {
        VesselData storage v = vessels[imo];
        if (v.navStatus != NavigationStatus.Moored) return false;
        
        VoyageData storage voy = voyages[imo];
        // No voyage data yet → assume at loading port (pre-departure)
        if (voy.lastUpdated == 0) return true;
        // ATD = 0 means not departed yet → at loading port
        if (voy.atdEpoch == 0) return true;
        // ATD in the future → scheduled but not departed
        if (voy.atdEpoch > block.timestamp) return true;
        
        return false;
    }

    /**
     * @notice Check if vessel has arrived at destination (moored at discharge port)
     * @dev A vessel has arrived if:
     *      1. Navigation status is Moored AND
     *      2. ATA epoch > 0 (has actually arrived) OR
     *      3. ATD epoch > 0 and ATD < now and ETA < now (departed and past ETA, moored = arrived)
     */
    function hasVesselArrived(string memory imo) external view returns (bool) {
        VesselData storage v = vessels[imo];
        if (v.navStatus != NavigationStatus.Moored) return false;
        
        VoyageData storage voy = voyages[imo];
        // Explicit arrival recorded
        if (voy.ataEpoch > 0) return true;
        // Departed + past ETA + moored = arrived
        if (voy.atdEpoch > 0 && voy.atdEpoch < block.timestamp && 
            voy.etaEpoch > 0 && voy.etaEpoch < block.timestamp) {
            return true;
        }
        
        return false;
    }

    /**
     * @notice Check if vessel is currently underway (departed but not arrived)
     */
    function isVesselUnderway(string memory imo) external view returns (bool) {
        VesselData storage v = vessels[imo];
        if (v.navStatus == NavigationStatus.UnderWay) return true;
        
        // Also check voyage data: departed but not arrived
        VoyageData storage voy = voyages[imo];
        if (voy.atdEpoch > 0 && voy.atdEpoch < block.timestamp && voy.ataEpoch == 0) {
            return true;
        }
        
        return false;
    }

    /// @notice Check if vessel has had a specific casualty type
    function hadCasualty(string memory imo, string memory casualtyType) external view returns (bool) {
        CasualtyRecord storage rec = casualtyRecords[imo];
        if (!rec.detected) return false;
        return keccak256(bytes(rec.casualtyType)) == keccak256(bytes(casualtyType));
    }

    /// @notice Check if vessel was detained in latest PSC inspection
    function wasVesselDetained(string memory imo) external view returns (bool) {
        return pscRecords[imo].detained;
    }

    /// @notice Check if vessel data exists and is recent enough
    function isDataFresh(string memory imo, uint256 maxAge) external view returns (bool) {
        VesselData storage v = vessels[imo];
        if (v.lastUpdated == 0) return false;
        return (block.timestamp - v.lastUpdated) <= maxAge;
    }
}
