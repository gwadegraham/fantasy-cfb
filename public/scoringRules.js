var leagueCode;

window.onload = async function () {
    function initNavbarToggle() {
        const toggleButton = document.querySelector('.toggle-button');
        const navbarLinks = document.querySelector('.navbar-links');

        if (toggleButton && navbarLinks) {
            toggleButton.addEventListener('click', () => {
                navbarLinks.classList.toggle('active');
            });
            console.log("✅ Navbar toggle initialized");
        } else {
            // Retry after 500ms if elements aren't in the DOM yet
            console.log("⏳ Navbar elements not found, retrying...");
            setTimeout(initNavbarToggle, 500);
        }
    }

    initNavbarToggle();
    setNavbarUserId();

    const response = await fetch(`/profile`, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
    });

    response.json().then(async data => {
        console.log("user metadata", data)

        // Only set leagueCode from metaData if it's not already stored
        if (!window.localStorage.getItem("leagueCode") && data?.user_metadata?.metadata?.league) {
            var newLeagueCode = (data.user_metadata.metadata.league == 'gg' ? 'graham-league' : 'claunts-league');
            window.localStorage.setItem("leagueCode", newLeagueCode);
        }

        if (userState.user_metadata.roles?.at(-1) == 'Admin') { 
            const leagueCode = window.localStorage.getItem("leagueCode");

            if (leagueCode && (leagueCode != "undefined")) {
                const currentSelectedLeague = window.sessionStorage.getItem("league");
                if (currentSelectedLeague) {
                    $("#dropdownMenuButton").text(currentSelectedLeague);
                }
            }
        }
    });
};

if ($("[league-selector]")) {
    setTimeout(() => {
        $("[league-selector] a").click(function(){
            $(this).parents(".dropdown").find('.btn').html($(this).text());
            $(this).parents(".dropdown").find('.btn').val($(this).attr('value'));
            var selectedLeague = $("#dropdownMenuButton").text();
            var selectedLeagueCode = $("#dropdownMenuButton").val();
            window.sessionStorage.setItem("league", selectedLeague);
            window.localStorage.setItem("leagueCode", selectedLeagueCode);
            window.location.reload();
        });
    }, "200");
}


function setNavbarUserId() {
    var userId = userState.user_metadata.metadata.userId || null;

    if (userId == null) {
        userId = window.localStorage.getItem("userId");
    }

    const toggleButton = document.querySelector('.toggle-button');
    const navbarLinks = document.querySelector('.navbar-links');
    const myLink = document.querySelector('[user-home]');

    if (toggleButton && navbarLinks && myLink) {
        myLink.href = `/userHome?user=${userId}`;
        console.log("✅ user profile link initialized");
    } else {
        // Retry after 500ms if elements aren't in the DOM yet
        console.log("⏳ Navbar elements not found, retrying...");
        setTimeout(setNavbarUserId, 500);
    }
}