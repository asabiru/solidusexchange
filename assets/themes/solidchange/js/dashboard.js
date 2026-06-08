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


// Dark theme — always dark, no toggle
const body = document.querySelector("body");
var loaderColor = "rgba(11, 6, 8, 0.94)";
var loaderColorDark = "rgba(11, 6, 8, 0.94)";

function setTheme() {
    var head = document.querySelector("head");
    $('#logoSet').attr('src', head.getAttribute("data-dark_logo"));
    $('#logoSetMobile').attr('src', head.getAttribute("data-dark_logo"));
    document.querySelector('body').classList.add('dark-theme');
    document.documentElement.setAttribute('data-solidus-site-theme', 'dark');
    localStorage.setItem('dark-theme', '1');
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







