// Preloader area
$(document).ready(function() {
    handlePreloader();

    if ($(".preloader-close").length) {
        $(".preloader-close").on("click", function() {
            $('.loader-wrap').stop(true).fadeOut(500);
        });
    }
});
// Preloader area end
// toggleSideMenu start
const toggleSideMenu = () => {
    document.body.classList.toggle("toggle-sidebar");
};
// toggleSideMenu end


// Dark theme start
const toggleBtn = document.getElementById("toggle-btn");
const body = document.querySelector("body");
if(toggleBtn){
    toggleBtn.addEventListener("click", function () {
        document.body.classList.toggle("dark-theme");
        if (document.body.classList.contains("dark-theme")) {
            localStorage.setItem("dark-theme", 1);
        } else {
            localStorage.setItem("dark-theme", 0);
        }
        setTheme();
    });
}


var loaderColor = "rgba(250, 244, 255, 0.92)";
var loaderColorDark = "rgba(45, 24, 78, 0.94)";
var loaderColorLight = "rgba(250, 244, 255, 0.92)";

function setTheme() {
    const isDarkTheme = localStorage.getItem("dark-theme");
    const head = document.querySelector("head");
    const defaultTheme = head.getAttribute("data-theme");

    if (isDarkTheme == 1) {
        $('#logoSet').attr('src', head.getAttribute("data-dark_logo"))
        $('#logoSetMobile').attr('src', head.getAttribute("data-dark_logo"))
        document.querySelector('body').classList.add('dark-theme');
        if (document.getElementById("moon")) {
            document.getElementById("moon").style.display = "none";
        }
        if (document.getElementById("sun")) {
            document.getElementById("sun").style.display = "block";
        }
        loaderColor = loaderColorDark;
    } else if (isDarkTheme == 0) {
        $('#logoSet').attr('src', head.getAttribute("data-light_logo"))
        $('#logoSetMobile').attr('src', head.getAttribute("data-light_logo"))
        document.querySelector('body').classList.remove('dark-theme');
        if (document.getElementById("moon")) {
            document.getElementById("moon").style.display = "block";
        }
        if (document.getElementById("sun")) {
            document.getElementById("sun").style.display = "none";
        }
        loaderColor = loaderColorLight;
    } else {
        if (defaultTheme == 1) {
            $('#logoSet').attr('src', head.getAttribute("data-dark_logo"))
            $('#logoSetMobile').attr('src', head.getAttribute("data-dark_logo"))
            document.querySelector('body').classList.add('dark-theme');
            if (document.getElementById("moon")) {
                document.getElementById("moon").style.display = "none";
            }
            if (document.getElementById("sun")) {
                document.getElementById("sun").style.display = "block";
            }
            loaderColor = loaderColorDark;
        } else {
            $('#logoSet').attr('src', head.getAttribute("data-light_logo"))
            $('#logoSetMobile').attr('src', head.getAttribute("data-light_logo"))
            document.querySelector('body').classList.remove('dark-theme');

            if (document.getElementById("moon")) {
                document.getElementById("moon").style.display = "block";
            }
            if (document.getElementById("sun")) {
                document.getElementById("sun").style.display = "none";
            }
            loaderColor = loaderColorLight;
        }
    }

    document.documentElement.setAttribute('data-solidus-site-theme', document.querySelector('body').classList.contains('dark-theme') ? 'dark' : 'light');
}

setTheme();
// Dark theme end


// input file preview
const previewImage = (id) => {
    document.getElementById(id).src = URL.createObjectURL(event.target.files[0]);
};

// Tooltip
const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]')
const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl));

// cmn select2 start
$(document).ready(function () {
    $('.cmn-select2').select2();
});
// cmn select2 end

// cmn-select2-modal
$(".modal-select").select2({
    dropdownParent: $("#formModal"),
});

// cmn-select2 with image start
$(document).ready(function () {
    $('.cmn-select2-image').select2({
        templateResult: formatState,
        templateSelection: formatState
    });
});

function handlePreloader() {
    if ($('.loader-wrap').length) {
        $('.loader-wrap').delay(1500).fadeOut(500);
    }
}

// select2 function
function formatState(state) {
    if (!state.id) {
        return state.text;
    }
    let imageUrl = $(state.element).data('img');
    var $state = $(
        '<span><img class="img-flag" /> <span></span></span>'
    );

    $state.find("span").text(state.text);
    $state.find("img").attr("src", imageUrl);
    return $state;
};
// cmn-select2 with image start


$(document).ready(function () {
    // owl carousel dashboard card
    $('.carousel-1').owlCarousel({
        loop: true,
        // autoplay: true,
        margin: -20,
        nav: false,
        dots: false,
        // rtl:true,
        responsive: {
            0: {
                items: 1
            },
            576: {
                items: 2
            },
            768: {
                items: 3
            }
        }
    });

});







