const toggleButton = document.getElementsByClassName('toggle-button')[0];
const navbarLinks = document.getElementsByClassName('navbar-links')[0];
var leagueCode;

toggleButton.addEventListener('click', () => {
    navbarLinks.classList.toggle('active');
});

window.onload = async function() {
    const response = await fetch(`/profile`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    response.json().then(async data => {
        console.log("user metadata", data)

        weekCode = window.localStorage.getItem("weekCode");
        const currentSelectedWeek = window.localStorage.getItem("week");
        if (currentSelectedWeek) {
            $("#dropdownMenuButtonWeek").text(currentSelectedWeek);
        } else {
            $("#dropdownMenuButtonWeek").text("Week 1");
            weekCode = window.localStorage.setItem("weekCode", "week-1");
        }

        leagueCode = window.sessionStorage.getItem("leagueCode");

        if (leagueCode && (leagueCode != "undefined")) {
            const currentSelectedLeague = window.sessionStorage.getItem("league");
            if (currentSelectedLeague) {
                $("#dropdownMenuButton").text(currentSelectedLeague);
            }
        } else {
            var userLeague = data.user_metadata.metadata.league;
            if (userLeague == "gg") {
                leagueCode = "graham-league";
            } else {
                leagueCode = "claunts-league";
            }
        }
        
        var userRole = data.user_metadata.roles[0];
        if (userRole != "Admin") {
            document.querySelector('[admin-page]').remove();
            document.querySelector('[league-selector]').remove();
        } else if (userRole == "Admin") {
            document.querySelector('.maintenance-container').style.display = 'none';
        }
    });
  };