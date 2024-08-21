const navbarLinks = document.getElementsByClassName('navbar-links')[0];
const toggleButton = document.getElementsByClassName('toggle-button')[0];
toggleButton.addEventListener('click', () => {
    navbarLinks.classList.toggle('active');
});

var leagueVersion;
var leagueCode;
var isMobile;
var teamOptionList;
var teamList = [];
var users = [];
var currentTeamIndex = 0;
var currentRound = 1;
var draftDirection = 1;
const totalRounds = 10;
const userTeams = [];

window.onload = async function() {
    detectMobile();
    await getUserProfile();
    await getTeams();
    setRecruitingHeader();
};

$('#myModal').on('shown.bs.modal', function () {
    $('#myInput').trigger('focus')
})

function detectMobile() {
    if(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/.test(navigator.userAgent)){
        // true for mobile device
        isMobile = true;
    } else{
        // false for not mobile device
        isMobile = false;
    }
}

async function getUserProfile() {
    const response = await fetch(`/profile`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    response.json().then(async data => {
        console.log("user metadata", data)
        var userLeague = data.user_metadata.metadata.league;
        var userRole = data.user_metadata.roles[0];

        if (userLeague == "gg") {
            leagueCode = "graham-league";
            leagueVersion = "V2";
        } else {
            leagueCode = "claunts-league";
            leagueVersion = "V1";
        }

        if (userRole != "Admin") {
            document.querySelector('[admin-page]').remove();
        }
        
        getUsers();
    });
}

async function getUsers() {

    const response = await fetch(`/users/league/${leagueCode}/previous`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    response.json().then(async data => {
        displayUsers(data);
    });
}

function displayUsers(data) {
    const draftTableBody = document.querySelector('[draft-table-body]');
    var str = '';

    data.sort((a, b) => {
        return a.seasons[0].cumulativeScore - b.seasons[0].cumulativeScore;
    });

    users = data;

    data.forEach( (user, index) => {
        userTeams.push(user.firstName);

        str += '<tr>';
        str += `<td>${user.firstName} ${user.lastName.substring(0,1)}.</td>`;

        for(var i = 1; i < 11; i++) {
            str += `<td id="${user._id}-round${i}"></td>`;
        }

        str += '</tr>';
    });

    draftTableBody.innerHTML = str;

    document.querySelectorAll('td[id*="-round"]').forEach(cell => {
        cell.addEventListener('click', function() {
            const currentTeamName = cell.children[0].alt;
    
            $('#changeTeamModal p:first').text(`Which team do you want to select instead of ${currentTeamName}?`);
    
            $('#changeTeamModal').attr("cell-id", cell.id);
            $('#changeTeamModal').attr("previous-school", currentTeamName);
            $('#changeTeamModal').attr("previous-value", cell.children[0].title);
            $('#changeTeamModal').modal('show');
        });
    });

    $(`*[id*=${users[currentTeamIndex]._id}]:visible`).each(function() {
        $(this).css('background-color', 'white');
    });

    // Initialize the current user and round display
    document.getElementById('current-team').textContent = `Current Team: ${userTeams[currentTeamIndex].charAt(0).toUpperCase() + userTeams[currentTeamIndex].slice(1)}`;
    document.getElementById('current-round').textContent = `Round ${currentRound}`;

    var previous;

    $("select").on('focus', function() {
        previous = this.value;

    }).on("change", function(){
        $('#team-form button').attr('disabled', false);

        if (previous != "") {
            $("select").find("option[value=" + previous + "]").show();
        }
        
        $("select").not(this).find("option[value=" + $(this).val() + "]").hide();
    });
}

async function getTeams() {
    fetch("/teams", {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    }).then(res => res.json()).then(data => {
        setTeamOptions(data);
        displayTeams(data);
    });
}

function setTeamOptions(data) {
    teamOptionList = document.querySelectorAll('[team-options]');
    teamList = data;
    var str = '<option value="" disabled selected>Select A Team</option>';
    
    data.sort((a, b) => {
        return a.school.localeCompare(b.school)
    });

    data.forEach( team => {
        str += '<option value="';
        str += team.id;
        str += '">' + team.school;
        str += '</option>';
    });

    teamOptionList.forEach(selector => {
        selector.innerHTML = str;
    });

    _multiplyNode(document.querySelector('.draft-team-container'), 1, true);
}

function setRecruitingHeader() {
    document.querySelector('[recruiting-ranking]').innerHTML = `${new Date().getFullYear()} Recruiting`;
}

async function getRecruitingRankings() {
    var response = await fetch(`/recruiting/${new Date().getFullYear()}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    var recruitingRankings = await response.json();

    return recruitingRankings;
}

async function displayTeams(data) {
    var recruitingRankings = await getRecruitingRankings();

    const userTableBody = document.querySelector('[user-table-body]');
    var str = '';

    data.sort((a, b) => {
        var aScore = 0;
        var bScore = 0;

        if (a.seasons.length > 0) {
            if (leagueVersion == "V1") {
                aScore = a.seasons[0].cumulativeScoreV1 || 0;
            } else {
                aScore = a.seasons[0].cumulativeScoreV2 || 0;
            }
        }

        if (b.seasons.length > 0) {
            if (leagueVersion == "V1") {
                bScore = b.seasons[0].cumulativeScoreV1 || 0;
            } else {
                bScore = b.seasons[0].cumulativeScoreV2 || 0;
            }
        }
        
        return bScore - aScore;
    });

    data.forEach( (team, index) => {
        var conference = "-";
        var cumulScoreV1 = 0;
        var cumulScoreV2 = 0;
        var expectedWins = 0;

        if (team.seasons.length > 0) {
            conference = team.seasons.at(-1).conference;
            cumulScoreV1 = team.seasons[0].cumulativeScoreV1;
            cumulScoreV2 = team.seasons[0].cumulativeScoreV2;
            expectedWins = (team.seasons.at(-1).expectedWins || 0);
        }

        str += '<tr><td style="text-align: left;">';
        refLink = "https://www.sports-reference.com/cfb/schools/" + team.school;
        refLink = refLink.replace(/\s/g, "-").toLowerCase();

        str += '<a target="_blank" href="' + refLink + '"><img src="' + team.logos[0] + '" alt="' + team.mascot + '">'
        str += team.school;
        str += '</td>';

        str += '<td>' + conference + '</td>';

        var teamRecruiting = recruitingRankings.filter(obj => {
            return obj.team == team.school
        })[0];

        str += '<td>' + teamRecruiting.rank + '</td>';

        if (leagueVersion == "V1") {
            str += '<td>' + cumulScoreV1 + '</td>';
        } else {
            str += '<td>' + cumulScoreV2 + '</td>';
        }

        str += '<td>O/U ' + expectedWins + '</td>'
        
        str += '</tr>';
    });

    userTableBody.innerHTML = str;
}

async function submitDraft() {

    var userBodies = [];

    users.forEach(
        user => {
            var userId = user._id;
            var userTeamSelections = $(`*[id*=${user._id}]`).toArray();

            const teamDocuments = [];
            userTeamSelections.forEach(
                team => {
                    var teamId = team.children[0].getAttribute("title");
                    var teamObj = teamList.find((element) => element.id == teamId);
                    teamDocuments.push(teamObj);
                }
            );

            var userBody = {
                "userId": userId,
                "teams": teamDocuments
            };

            userBodies.push(userBody);
        }
    );
    console.log("userBodies", userBodies)

    var isSuccess = [];

    for (let user of userBodies) {
        var userUpdated = await updateUser(user.userId, user.teams);
        isSuccess.push(userUpdated);
    }

    if (isSuccess.includes(false)) {
        failToast.options.text = "Some users could not be updated for the new season";
        failToast.showToast();
    } else {
        successToast.options.text = "Draft submitted successfully";
        successToast.showToast();
        startConfetti();
        $('#submit-draft button').attr('disabled', true)
    }
}

async function updateUser(userId, teams) {
    
    var requestBody = `{
        "season": ${new Date().getFullYear()},
        "teams": ${JSON.stringify(teams)}
        }`;

    const response = await fetch(`/users/draft/` + userId, {
        method: 'PATCH',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        },
        body: requestBody,
    });
        
    var updateSuccessful = response.json().then(data => {
        if (response.status == 200) {
            return true;
        } else {
            return false;
        }
    });

    return updateSuccessful;
}

function updateDraftOrder() {

    if ((currentTeamIndex == (userTeams.length - 1)) && (draftDirection == 1)){
        draftDirection = -1;
        currentRound++;
    } else if ((currentTeamIndex == 0) && (draftDirection == -1)) {
        draftDirection = 1;
        currentRound++;
    } else if (draftDirection === 1) {
        currentTeamIndex++;
    } else {
        currentTeamIndex--;
    }

    if (currentRound > 10) {
        $("#submit-draft").removeAttr("hidden");
        $('#team').attr('disabled', true)
        $('#team-form button').attr('disabled', true)

        document.getElementById('team-form').removeEventListener('submit', this);
    } else {
        document.getElementById('current-team').textContent = `Current Team: ${userTeams[currentTeamIndex].charAt(0).toUpperCase() + userTeams[currentTeamIndex].slice(1)}`;
        document.getElementById('current-round').textContent = `Round ${currentRound}`;
        $(`*[id*=${users[currentTeamIndex]._id}]:visible`).each(function() {
            $(this).css('background-color', 'white');
        });
    }
}

function confirmNewTeam(){
    
    const newTeamValue = $('#changeTeamModal select').val();

    $('#changeTeamModal').modal('hide');
    var teamObject = teamList.filter(obj => {
        return obj.id == newTeamValue
    })[0];

    if (newTeamValue) {
        const currentTeamName = $('#changeTeamModal').attr("previous-school");
        const currentTeamValue = $('#changeTeamModal').attr("previous-value");
        const teamIndex = userTeams.findIndex(team => team === currentTeamName);
        const cellId = $('#changeTeamModal').attr("cell-id");
        const newCell = document.getElementById(cellId); // Use original cell ID to retrieve newCell

        if (newCell) {
            const img = document.createElement('img');
            img.src = teamObject.logos[0];
            img.alt = teamObject.school;
            img.title = teamObject.id;
            newCell.innerHTML = '';
            newCell.appendChild(img);
            userTeams[teamIndex] = newTeamValue;

            $("select").find("option[value=" + currentTeamValue + "]").show();
        }
    }
}

//Event Listener for Add Team Event
document.getElementById('team-form').addEventListener('submit', function(event) {
    event.preventDefault();

    $('#team-form button').attr('disabled', true);

    $(`*[id*=${users[currentTeamIndex]._id}]:visible`).each(function() {
        $(this).css('background-color', '#b0b0b08f');
    });

    const teamName = document.getElementById('team').value;
    const team = users[currentTeamIndex]._id;
    const round = `round${currentRound}`;

    var teamObject = teamList.filter(obj => {
        return obj.id == teamName
    })[0];
    
    const cellId = `${team}-${round}`;
    const cell = document.getElementById(cellId);
    
    if (cell) {
        const img = document.createElement('img');
        img.src = teamObject.logos[0];
        img.alt = teamObject.school;
        img.title = teamObject.id
        cell.innerHTML = '';
        cell.appendChild(img);
        document.getElementById('team-form').reset();
        updateDraftOrder();

    } else {
        alert('Error: Invalid team or round selection');
    }
    $("select").find("option[value=" + teamName + "]").hide();
});

// Event listener for team logo click
document.querySelectorAll('td[id*="-round"]').forEach(cell => {
    cell.addEventListener('click', function() {
        const currentTeamName = cell.children[0].alt;

        $('#changeTeamModal p:first').text(`Which team do you want to select instead of ${currentTeamName}?`);
        $('#changeTeamModal').attr("cell-id", cell.id);
        $('#changeTeamModal').attr("previous-school", currentTeamName);
        $('#changeTeamModal').attr("previous-value", cell.children[0].title);
        $('#changeTeamModal').modal('show');
    });
});

/////////////////////////////////////////////////////
//////////////////Helper Functions///////////////////
/////////////////////////////////////////////////////

function _multiplyNode(node, count, deep) {
    for (var i = 0, copy; i < count - 1; i++) {
        copy = node.cloneNode(deep);
        node.parentNode.insertBefore(copy, node);
    }
}

const _filterFunction = () => {
    const columns = [
      { name: 'Team', index: 0, isFilter: true },
      { name: 'Conference', index: 1, isFilter: true }
    ]
    const filterColumns = columns.filter(c => c.isFilter).map(c => c.index)
    const trs = document.querySelectorAll(`.fl-table tr:not(.headerRow)`)
    const filter = document.querySelector('#myInput').value.replace(/\s/g, "");
    const regex = new RegExp(escape(filter), 'i')
    const isFoundInTds = td => regex.test(td.innerHTML.replace(/\s/g, ""))
    const isFound = childrenArr => childrenArr.some(isFoundInTds)
    const setTrStyleDisplay = ({ style, children }) => {
      style.display = isFound([
        ...filterColumns.map(c => children[c]) // <-- filter Columns
      ]) ? '' : 'none'
    }
    
    trs.forEach(setTrStyleDisplay)
};

var successToast = Toastify({
    text: "",
    duration: 4000,
    close: true,
    gravity: "top", // `top` or `bottom`
    position: "left", // `left`, `center` or `right`
    stopOnFocus: true, // Prevents dismissing of toast on hover
    style: {
      background: "#71d28d",
      color: "#222"
    },
    offset: {
        y: '40px' // vertical axis - can be a number or a string indicating unity. eg: '2em'
    },
});

var failToast = Toastify({
    text: "",
    duration: 3000,
    close: true,
    gravity: "top", // `top` or `bottom`
    position: "left", // `left`, `center` or `right`
    stopOnFocus: true, // Prevents dismissing of toast on hover
    style: {
      background: "#d27171",
      color: "#222"
    },
    offset: {
        y: '40px' // vertical axis - can be a number or a string indicating unity. eg: '2em'
    },
});