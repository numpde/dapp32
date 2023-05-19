
from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    # https://reactive-python.github.io/reactpy-django/get-started/installation/
    path("reactpy/", include("reactpy_django.http.urls")),

    path('admin/', admin.site.urls),
]
