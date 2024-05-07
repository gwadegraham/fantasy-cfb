const teamOptionList = document.querySelectorAll('[team-options]');

const toggleButton = document.getElementsByClassName('toggle-button')[0];
const navbarLinks = document.getElementsByClassName('navbar-links')[0];
const listOfTeams = [];
var leagueVersion;
var leagueCode;
var isMobile;
var teamList = [];

function detectMobile() {
    if(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/.test(navigator.userAgent)){
        // true for mobile device
        isMobile = true;
    } else{
        // false for not mobile device
        isMobile = false;
    }
}

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
      background: "#71d28d",
      color: "#222"
    },
    offset: {
        y: '40px' // vertical axis - can be a number or a string indicating unity. eg: '2em'
    },
});

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

function multiplyNode(node, count, deep) {
    for (var i = 0, copy; i < count - 1; i++) {
        copy = node.cloneNode(deep);
        node.parentNode.insertBefore(copy, node);
    }
}

function setTeamOptions(data) {
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

    multiplyNode(document.querySelector('.draft-team-container'), 1, true);
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
    });
}



toggleButton.addEventListener('click', () => {
    navbarLinks.classList.toggle('active');
});

window.onload = async function() {
    detectMobile();
    getUserProfile();
    getTeams();
};

async function displayTeams(data) {
    const userTableBody = document.querySelector('[user-table-body]');
    var str = '';

    data.sort((a, b) => {
        if (leagueVersion == "V1") {
            var aScore = a.cumulativeScoreV1 || 0;
            var bScore = b.cumulativeScoreV1 || 0;
        } else {
            var aScore = a.cumulativeScoreV2 || 0;
            var bScore = b.cumulativeScoreV2 || 0;
        }
        
        return bScore - aScore;
    });

    var currentWeeksLength = 16;

    data.forEach( (team, index) => {
        var totalScore = 0;

        str += '<tr><td style="text-align: left; wi">';
        refLink = "https://www.sports-reference.com/cfb/schools/" + team.school;
        refLink = refLink.replace(/\s/g, "-").toLowerCase();

        str += '<a target="_blank" href="' + refLink + '"><img src="' + team.logos[0] + '" alt="' + team.mascot + '">'
        str += team.school;
        str += '</td>';

        str += '<td>' + team.conference + '</td>';

        if (leagueVersion == "V1") {
            str += '<td>' + (team.cumulativeScoreV1 || "0") + '</td>';
        } else {
            str += '<td>' + (team.cumulativeScoreV2 || "0") + '</td>';
        }
        

        str += '</tr>';
    });

    userTableBody.innerHTML = str;
}

const filterFunction = () => {
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

const displayTeamLogo = (row,value) => {
    var result = teamList.filter(obj => {
        return obj.id == value
      })

    row[0].innerHTML = '<img style="padding-left: 10px; width: 40px;" src="' + result[0].logos[0] + '" alt="' + result[0].mascot + '">';
};