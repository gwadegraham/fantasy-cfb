document.write('\
<head>\
    <link rel="shortcut icon" type="image/png" href="images/favicon.png"/>\
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.1/css/all.min.css" rel="stylesheet"/>\
    <link  href="/../main.css">\
    <!-- Bootstrap CSS -->\
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/4.6.1/css/bootstrap.min.css" integrity="sha512-T584yQ/tdRR5QwOpfvDfVQUidzfgc2339Lc8uBDtcp/wYu80d7jwBgAxbyMh0a9YM9F8N3tdErpFI8iaGx6x5g==" crossorigin="anonymous" referrerpolicy="no-referrer">\
    <link rel="preconnect" href="https://fonts.googleapis.com">\
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\
    <link href="https://fonts.googleapis.com/css2?family=Graduate&family=Pacifico&display=swap" rel="stylesheet">\
    <!-- JQuery -->\
    <script src="https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js"></script>\
    <script src="https://cdnjs.cloudflare.com/ajax/libs/popper.js/1.11.0/umd/popper.min.js" integrity="sha384-b/U6ypiBEHpOf/4+1nzFpr53nxSS+GLCkfwBdFNTxtclqqenISfwAzpKaMNFNmj4" crossorigin="anonymous"></script>\
    <!-- Bootstrap JS -->\
    <script src="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/4.6.1/js/bootstrap.min.js" integrity="sha512-UR25UO94eTnCVwjbXozyeVd6ZqpaAE9naiEUBK/A+QDbfSTQFhPGj5lOR6d8tsgbBk84Ggb5A3EkjsOgPRPcKA==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>\
</head>\
<nav id="navbar" class="navbar">\
    <div class="brand-title" style="display: flex; flex-flow: column;">\
        <div style="font-family: Graduate, serif;font-weight: 400;font-style: normal;margin: auto;">CAMPUS</div>\
        <div style="font-family: Pacifico, cursive;font-weight: 400;font-style: normal;margin: auto;margin-top: -18%;">Clash</div>\
    </div>\
    <a href="#" class="toggle-button">\
        <span class="bar"></span>\
        <span class="bar"></span>\
        <span class="bar"></span>\
        <span class="bar"></span>\
    </a>\
    <div class="navbar-links">\
        <ul>\
            <li><a admin-page href="./admin">Admin</a></li>\
            <li league-selector>\
                <div class="dropdown dropdown-nav">\
                    <button class="btn btn-secondary dropdown-toggle" type="button" id="dropdownMenuButton" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">\
                        Leagues\
                    </button>\
                    <div class="dropdown-menu dropdown-menu-right" aria-labelledby="dropdownMenuButton">\
                        <a class="dropdown-item" href="#" value="claunts-league">Claunts League</a>\
                        <a class="dropdown-item selected" href="#" value="graham-league">Graham League</a>\
                    </div>\
                </div>\
            </li>\
            <li><a href="./standings">Standings</a></li>\
            <li><a href="./rules">Scoring</a></li>\
            <li><a href="./draft-room">Draft Room</a></li>\
            <li><a href="./logout">Logout</a></li>\
        </ul>\
    </div>\
</nav>\
');