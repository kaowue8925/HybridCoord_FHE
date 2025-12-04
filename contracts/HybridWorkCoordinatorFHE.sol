// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract HybridWorkCoordinatorFHE is SepoliaConfig {
    struct EncryptedPreference {
        uint256 id;
        address employee;
        euint32 encryptedDaysInOffice;  // Encrypted days in office preference
        euint32 encryptedTeamDays;      // Encrypted preferred team collaboration days
        euint32 encryptedFocusDays;    // Encrypted preferred focus days
        euint32 encryptedFlexibility;   // Encrypted flexibility score
        uint256 timestamp;
    }
    
    struct TeamSchedule {
        euint32 encryptedOfficeDays;    // Encrypted team office days
        euint32 encryptedCollabDays;    // Encrypted team collaboration days
        euint32 encryptedOverlapScore;  // Encrypted team overlap score
        bool isOptimized;
    }
    
    struct PersonalSchedule {
        euint32 encryptedOfficeDays;    // Encrypted personal office days
        euint32 encryptedCollabDays;    // Encrypted personal collaboration days
        bool isAssigned;
    }
    
    struct DecryptedSchedule {
        uint32 officeDays;
        uint32 collabDays;
        bool isRevealed;
    }

    uint256 public preferenceCount;
    mapping(uint256 => EncryptedPreference) public employeePreferences;
    mapping(address => TeamSchedule) public teamSchedules;
    mapping(address => PersonalSchedule) public personalSchedules;
    mapping(address => DecryptedSchedule) public decryptedSchedules;
    
    mapping(address => uint256[]) private employeePreferences;
    mapping(address => address[]) private teamMembers;
    
    mapping(uint256 => uint256) private requestToPreferenceId;
    
    event PreferenceSubmitted(uint256 indexed id, address indexed employee);
    event ScheduleOptimized(address indexed team);
    event ScheduleAssigned(address indexed employee);
    event ScheduleDecrypted(address indexed employee);
    
    address public hrAdmin;
    
    modifier onlyAdmin() {
        require(msg.sender == hrAdmin, "Not admin");
        _;
    }
    
    modifier onlyEmployee() {
        // In real implementation, verify employee status
        _;
    }
    
    constructor() {
        hrAdmin = msg.sender;
    }
    
    /// @notice Submit encrypted work preference
    function submitEncryptedPreference(
        euint32 encryptedDaysInOffice,
        euint32 encryptedTeamDays,
        euint32 encryptedFocusDays,
        euint32 encryptedFlexibility
    ) public onlyEmployee {
        preferenceCount += 1;
        uint256 newId = preferenceCount;
        
        employeePreferences[newId] = EncryptedPreference({
            id: newId,
            employee: msg.sender,
            encryptedDaysInOffice: encryptedDaysInOffice,
            encryptedTeamDays: encryptedTeamDays,
            encryptedFocusDays: encryptedFocusDays,
            encryptedFlexibility: encryptedFlexibility,
            timestamp: block.timestamp
        });
        
        personalSchedules[msg.sender] = PersonalSchedule({
            encryptedOfficeDays: FHE.asEuint32(0),
            encryptedCollabDays: FHE.asEuint32(0),
            isAssigned: false
        });
        
        decryptedSchedules[msg.sender] = DecryptedSchedule({
            officeDays: 0,
            collabDays: 0,
            isRevealed: false
        });
        
        employeePreferences[msg.sender].push(newId);
        emit PreferenceSubmitted(newId, msg.sender);
    }
    
    /// @notice Optimize team schedule
    function optimizeTeamSchedule(address team) public onlyAdmin {
        address[] memory members = teamMembers[team];
        require(members.length > 0, "No team members");
        
        euint32 totalOfficeDays = FHE.asEuint32(0);
        euint32 totalCollabDays = FHE.asEuint32(0);
        euint32 overlapScore = FHE.asEuint32(0);
        
        for (uint i = 0; i < members.length; i++) {
            uint256[] memory prefs = employeePreferences[members[i]];
            if (prefs.length == 0) continue;
            
            EncryptedPreference storage pref = employeePreferences[prefs[prefs.length - 1]];
            
            totalOfficeDays = FHE.add(totalOfficeDays, pref.encryptedDaysInOffice);
            totalCollabDays = FHE.add(totalCollabDays, pref.encryptedTeamDays);
            
            // Calculate overlap with previous member
            if (i > 0) {
                EncryptedPreference storage prevPref = employeePreferences[employeePreferences[members[i-1]][employeePreferences[members[i-1]].length - 1]];
                overlapScore = FHE.add(
                    overlapScore,
                    calculateDayOverlap(pref.encryptedTeamDays, prevPref.encryptedTeamDays)
                );
            }
        }
        
        // Calculate average days
        euint32 avgOfficeDays = FHE.div(totalOfficeDays, FHE.asEuint32(uint32(members.length)));
        euint32 avgCollabDays = FHE.div(totalCollabDays, FHE.asEuint32(uint32(members.length)));
        
        teamSchedules[team] = TeamSchedule({
            encryptedOfficeDays: avgOfficeDays,
            encryptedCollabDays: avgCollabDays,
            encryptedOverlapScore: overlapScore,
            isOptimized: true
        });
        
        emit ScheduleOptimized(team);
    }
    
    /// @notice Assign personal schedule
    function assignPersonalSchedule(address employee) public onlyAdmin {
        address team = getEmployeeTeam(employee);
        require(teamSchedules[team].isOptimized, "Team schedule not optimized");
        
        uint256[] memory prefs = employeePreferences[employee];
        require(prefs.length > 0, "No preferences");
        
        EncryptedPreference storage pref = employeePreferences[prefs[prefs.length - 1]];
        TeamSchedule storage teamSchedule = teamSchedules[team];
        
        // Balance personal preference with team needs
        euint32 officeDays = FHE.div(
            FHE.add(pref.encryptedDaysInOffice, teamSchedule.encryptedOfficeDays),
            FHE.asEuint32(2)
        );
        
        euint32 collabDays = FHE.div(
            FHE.add(pref.encryptedTeamDays, teamSchedule.encryptedCollabDays),
            FHE.asEuint32(2)
        );
        
        personalSchedules[employee] = PersonalSchedule({
            encryptedOfficeDays: officeDays,
            encryptedCollabDays: collabDays,
            isAssigned: true
        });
        
        emit ScheduleAssigned(employee);
    }
    
    /// @notice Request schedule decryption
    function requestScheduleDecryption() public onlyEmployee {
        require(personalSchedules[msg.sender].isAssigned, "Schedule not assigned");
        require(!decryptedSchedules[msg.sender].isRevealed, "Already decrypted");
        
        PersonalSchedule storage schedule = personalSchedules[msg.sender];
        
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(schedule.encryptedOfficeDays);
        ciphertexts[1] = FHE.toBytes32(schedule.encryptedCollabDays);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptPersonalSchedule.selector);
        requestToPreferenceId[reqId] = 0; // Using 0 to indicate personal schedule request
    }
    
    /// @notice Process decrypted personal schedule
    function decryptPersonalSchedule(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        address employee = msg.sender;
        require(personalSchedules[employee].isAssigned, "Schedule not assigned");
        require(!decryptedSchedules[employee].isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (uint32 officeDays, uint32 collabDays) = abi.decode(cleartexts, (uint32, uint32));
        
        decryptedSchedules[employee].officeDays = officeDays;
        decryptedSchedules[employee].collabDays = collabDays;
        decryptedSchedules[employee].isRevealed = true;
        
        emit ScheduleDecrypted(employee);
    }
    
    /// @notice Calculate day overlap
    function calculateDayOverlap(euint32 days1, euint32 days2) private pure returns (euint32) {
        // Simplified overlap calculation (bitwise AND in FHE)
        return FHE.and(days1, days2);
    }
    
    /// @notice Calculate schedule satisfaction
    function calculateSatisfaction(address employee) public view returns (euint32) {
        PersonalSchedule storage schedule = personalSchedules[employee];
        require(schedule.isAssigned, "Schedule not assigned");
        
        uint256[] memory prefs = employeePreferences[employee];
        if (prefs.length == 0) return FHE.asEuint32(0);
        
        EncryptedPreference storage pref = employeePreferences[prefs[prefs.length - 1]];
        
        // Calculate alignment with preferences
        euint32 officeAlignment = FHE.sub(
            FHE.asEuint32(100),
            FHE.div(
                FHE.abs(FHE.sub(schedule.encryptedOfficeDays, pref.encryptedDaysInOffice)),
                FHE.asEuint32(10)
            )
        );
        
        euint32 collabAlignment = FHE.sub(
            FHE.asEuint32(100),
            FHE.div(
                FHE.abs(FHE.sub(schedule.encryptedCollabDays, pref.encryptedTeamDays)),
                FHE.asEuint32(10)
            )
        );
        
        return FHE.div(
            FHE.add(officeAlignment, collabAlignment),
            FHE.asEuint32(2)
        );
    }
    
    /// @notice Calculate team collaboration potential
    function calculateTeamCollaboration(address team) public view returns (euint32) {
        TeamSchedule storage schedule = teamSchedules[team];
        require(schedule.isOptimized, "Schedule not optimized");
        
        return schedule.encryptedOverlapScore;
    }
    
    /// @notice Add employee to team
    function addToTeam(address employee, address team) public onlyAdmin {
        teamMembers[team].push(employee);
    }
    
    /// @notice Get employee team
    function getEmployeeTeam(address employee) private view returns (address) {
        // In real implementation, map employee to team
        return address(0); // Simplified
    }
    
    /// @notice Calculate flexibility utilization
    function calculateFlexibilityUtilization(address team) public view returns (euint32) {
        address[] memory members = teamMembers[team];
        euint32 totalFlexibility = FHE.asEuint32(0);
        uint32 count = 0;
        
        for (uint i = 0; i < members.length; i++) {
            uint256[] memory prefs = employeePreferences[members[i]];
            if (prefs.length == 0) continue;
            
            EncryptedPreference storage pref = employeePreferences[prefs[prefs.length - 1]];
            totalFlexibility = FHE.add(totalFlexibility, pref.encryptedFlexibility);
            count++;
        }
        
        return count > 0 ? FHE.div(totalFlexibility, FHE.asEuint32(count)) : FHE.asEuint32(0);
    }
    
    /// @notice Optimize for focus time
    function optimizeFocusTime(address employee) public view returns (euint32) {
        PersonalSchedule storage schedule = personalSchedules[employee];
        require(schedule.isAssigned, "Schedule not assigned");
        
        uint256[] memory prefs = employeePreferences[employee];
        if (prefs.length == 0) return FHE.asEuint32(0);
        
        EncryptedPreference storage pref = employeePreferences[prefs[prefs.length - 1]];
        
        // Focus days = office days - collaboration days
        return FHE.sub(schedule.encryptedOfficeDays, schedule.encryptedCollabDays);
    }
    
    /// @notice Calculate hybrid work efficiency
    function calculateEfficiency(address team) public view returns (euint32) {
        TeamSchedule storage schedule = teamSchedules[team];
        require(schedule.isOptimized, "Schedule not optimized");
        
        // Efficiency based on collaboration days and overlap
        return FHE.div(
            FHE.mul(schedule.encryptedCollabDays, schedule.encryptedOverlapScore),
            FHE.asEuint32(100)
        );
    }
    
    /// @notice Get encrypted preference
    function getEncryptedPreference(uint256 prefId) public view returns (
        address employee,
        euint32 encryptedDaysInOffice,
        euint32 encryptedTeamDays,
        euint32 encryptedFocusDays,
        euint32 encryptedFlexibility,
        uint256 timestamp
    ) {
        EncryptedPreference storage p = employeePreferences[prefId];
        return (
            p.employee,
            p.encryptedDaysInOffice,
            p.encryptedTeamDays,
            p.encryptedFocusDays,
            p.encryptedFlexibility,
            p.timestamp
        );
    }
    
    /// @notice Get team schedule
    function getTeamSchedule(address team) public view returns (
        euint32 encryptedOfficeDays,
        euint32 encryptedCollabDays,
        euint32 encryptedOverlapScore,
        bool isOptimized
    ) {
        TeamSchedule storage s = teamSchedules[team];
        return (
            s.encryptedOfficeDays,
            s.encryptedCollabDays,
            s.encryptedOverlapScore,
            s.isOptimized
        );
    }
    
    /// @notice Get personal schedule
    function getPersonalSchedule(address employee) public view returns (
        euint32 encryptedOfficeDays,
        euint32 encryptedCollabDays,
        bool isAssigned
    ) {
        PersonalSchedule storage s = personalSchedules[employee];
        return (
            s.encryptedOfficeDays,
            s.encryptedCollabDays,
            s.isAssigned
        );
    }
    
    /// @notice Get decrypted schedule
    function getDecryptedSchedule(address employee) public view returns (
        uint32 officeDays,
        uint32 collabDays,
        bool isRevealed
    ) {
        DecryptedSchedule storage s = decryptedSchedules[employee];
        return (s.officeDays, s.collabDays, s.isRevealed);
    }
    
    /// @notice Calculate schedule conflict
    function calculateScheduleConflict(address team) public view returns (euint32) {
        TeamSchedule storage schedule = teamSchedules[team];
        require(schedule.isOptimized, "Schedule not optimized");
        
        // Conflict when collaboration days exceed office days
        return FHE.sub(schedule.encryptedCollabDays, schedule.encryptedOfficeDays);
    }
    
    /// @notice Adjust for team events
    function adjustForTeamEvents(address team, euint32 eventDays) public onlyAdmin {
        TeamSchedule storage schedule = teamSchedules[team];
        require(schedule.isOptimized, "Schedule not optimized");
        
        // Increase collaboration days for team events
        schedule.encryptedCollabDays = FHE.add(schedule.encryptedCollabDays, eventDays);
    }
    
    /// @notice Calculate work-life balance
    function calculateWorkLifeBalance(address employee) public view returns (euint32) {
        PersonalSchedule storage schedule = personalSchedules[employee];
        require(schedule.isAssigned, "Schedule not assigned");
        
        // Balance = 100 - (office days * 10)
        return FHE.sub(
            FHE.asEuint32(100),
            FHE.mul(schedule.encryptedOfficeDays, FHE.asEuint32(10))
        );
    }
    
    /// @notice Predict collaboration opportunities
    function predictCollaborationOpportunities(address team) public view returns (euint32) {
        TeamSchedule storage schedule = teamSchedules[team];
        require(schedule.isOptimized, "Schedule not optimized");
        
        return schedule.encryptedOverlapScore;
    }
    
    /// @notice Calculate remote work impact
    function calculateRemoteWorkImpact(address team) public view returns (euint32) {
        TeamSchedule storage schedule = teamSchedules[team];
        require(schedule.isOptimized, "Schedule not optimized");
        
        // Remote days = 5 - office days
        euint32 remoteDays = FHE.sub(FHE.asEuint32(5), schedule.encryptedOfficeDays);
        return FHE.mul(remoteDays, FHE.asEuint32(20)); // 20 points per remote day
    }
    
    /// @notice Optimize for cross-team collaboration
    function optimizeCrossTeamCollab(address team1, address team2) public onlyAdmin {
        TeamSchedule storage schedule1 = teamSchedules[team1];
        TeamSchedule storage schedule2 = teamSchedules[team2];
        require(schedule1.isOptimized && schedule2.isOptimized, "Schedules not optimized");
        
        // Find common collaboration days
        euint32 commonDays = calculateDayOverlap(schedule1.encryptedCollabDays, schedule2.encryptedCollabDays);
        
        // Increase collaboration days for both teams
        schedule1.encryptedCollabDays = FHE.add(schedule1.encryptedCollabDays, commonDays);
        schedule2.encryptedCollabDays = FHE.add(schedule2.encryptedCollabDays, commonDays);
    }
    
    /// @notice Calculate employee engagement
    function calculateEmployeeEngagement(address employee) public view returns (euint32) {
        PersonalSchedule storage schedule = personalSchedules[employee];
        require(schedule.isAssigned, "Schedule not assigned");
        
        // Engagement based on alignment with preferences
        return calculateSatisfaction(employee);
    }
    
    /// @notice Generate schedule recommendations
    function generateRecommendations(address employee) public view returns (euint32) {
        PersonalSchedule storage schedule = personalSchedules[employee];
        require(schedule.isAssigned, "Schedule not assigned");
        
        uint256[] memory prefs = employeePreferences[employee];
        if (prefs.length == 0) return FHE.asEuint32(0);
        
        EncryptedPreference storage pref = employeePreferences[prefs[prefs.length - 1]];
        
        // Recommend adjustments based on flexibility
        return FHE.cmux(
            FHE.gt(pref.encryptedFlexibility, FHE.asEuint32(70)),
            FHE.add(schedule.encryptedOfficeDays, FHE.asEuint32(1)),
            schedule.encryptedOfficeDays
        );
    }
    
    /// @notice Calculate team cohesion
    function calculateTeamCohesion(address team) public view returns (euint32) {
        TeamSchedule storage schedule = teamSchedules[team];
        require(schedule.isOptimized, "Schedule not optimized");
        
        // Cohesion based on overlap score
        return schedule.encryptedOverlapScore;
    }
    
    /// @notice Adjust for personal constraints
    function adjustForPersonalConstraints(address employee, euint32 constraintDays) public onlyAdmin {
        PersonalSchedule storage schedule = personalSchedules[employee];
        require(schedule.isAssigned, "Schedule not assigned");
        
        // Reduce office days due to constraints
        schedule.encryptedOfficeDays = FHE.sub(schedule.encryptedOfficeDays, constraintDays);
    }
    
    /// @notice Calculate optimal team size
    function calculateOptimalTeamSize(address team) public view returns (euint32) {
        TeamSchedule storage schedule = teamSchedules[team];
        require(schedule.isOptimized, "Schedule not optimized");
        
        // Optimal size based on collaboration days
        return FHE.div(schedule.encryptedCollabDays, FHE.asEuint32(2));
    }
    
    /// @notice Predict schedule adherence
    function predictScheduleAdherence(address employee) public view returns (euint32) {
        PersonalSchedule storage schedule = personalSchedules[employee];
        require(schedule.isAssigned, "Schedule not assigned");
        
        uint256[] memory prefs = employeePreferences[employee];
        if (prefs.length == 0) return FHE.asEuint32(0);
        
        EncryptedPreference storage pref = employeePreferences[prefs[prefs.length - 1]];
        
        // Adherence based on flexibility and preference alignment
        return FHE.div(
            FHE.add(pref.encryptedFlexibility, calculateSatisfaction(employee)),
            FHE.asEuint32(2)
        );
    }
}